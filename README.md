# 收看五星体育 / SMG 电视频道（绕过版权限制）

打开 [看看新闻](https://live.kankanews.com/huikan?id=10) 看五星体育等 SMG 频道时，F1 等版权节目会显示：

> **"版权受限，此时段不提供电视网络转播服务"**

这是因为服务端返回的节目数据中 `is_shield=1`，且频道带有 `copyright_image` 版权遮罩图，前端据此拦截播放。

本项目提供**三种方式**绕过这个限制。

---

## 为什么看不了？

看看新闻是一个 **Nuxt.js（Vue 2）单页应用**。页面加载时，服务端直接返回了带版权标志的节目数据：

| 字段 | 含义 | 被屏蔽时的值 |
|------|------|-------------|
| `programObj.is_shield` | 节目是否被屏蔽 | `1`（屏蔽） |
| `programObj.is_review` | 是否可回看 | `0`（不可） |
| `programObj.can_review` | 是否允许回看 | `0`（不允许） |
| `currChannelDetail.copyright_image` | 版权遮罩图 URL | 一个 JPG 图片地址 |

前端 Vue 组件检测到 `is_shield=1` 后，不初始化播放器，而是在 `.live-player` 上面覆盖一层 `.image-mask`（版权提示图）。

## 绕过原理

1. **隐藏 `.image-mask`** — 把版权遮罩图藏掉
2. **修改 Vue 组件数据** — 把 `is_shield` 改成 `0`，`is_review` / `can_review` 改成 `1`，清空 `copyright_image`
3. **绕过 `isCopyright` 开关**（2026-08 新增）— 网站在 Vue 组件上加了 `isCopyright` 标志，为真时 `initPlayer()` 会直接销毁播放器，必须设为 `false`
4. **恢复流地址**（2026-08 新增）— 服务端不再把 `live_address` 放进节目详情接口，需要从频道接口复制回来
5. **手动调用 `initPlayer()`** — 触发播放器初始化，解密 `live_address` 并加载 HLS 视频流

五步做完，xgplayer 播放器正常加载，HLS 流开始播放。

---

## 快速开始

### 方式一：Console 粘贴（最简单，每次刷新后要重新粘贴，20260821更新可用，强烈推荐）

1. 用 Edge / Chrome 打开 https://live.kankanews.com/huikan?id=10
2. 按 **F12** → 点 **Console** 标签
3. 粘贴以下代码，回车：

```js
var v=document.querySelector('.huikan').__vue__;
function f(o){if(!o)return;o.is_shield=0;o.is_review=1;o.can_review=1}
f(v.programObj);f(v.programDetail);f(v.playingProgramObj);
v.currChannelDetail.copyright_image='';
v.programDetail.channel_info=v.programDetail.channel_info||{};
v.programDetail.channel_info.live_address=v.currChannelDetail.live_address;
v.isCopyright=false;
document.querySelector('.image-mask').style.display='none';
v.initPlayer();
```

4. 播放器出现，开始观看。

> ⚠️ 刷新页面后需要重新粘贴。切换频道不受影响。
>
> 📅 **2026-08-21 更新说明**：网站加了两个新拦截：
> 1. Vue 组件新增 `isCopyright` 标志，为真时 `initPlayer()` 会直接销毁播放器 → 需要设 `v.isCopyright=false`
> 2. 服务端把 `/program/detail` 接口的 `live_address` 清空了 → 需要从频道接口复制：`v.programDetail.channel_info.live_address = v.currChannelDetail.live_address`

---

### 方式二：Tampermonkey 脚本（自动运行，理论上可行，但我用不了，这里力荐方式一）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器插件
2. 点击 Tampermonkey 图标 → **创建新脚本**
3. 把 `smg_fivestar.user.js` 的全部内容粘贴进去
4. **Ctrl+S 保存**
5. 打开 https://live.kankanews.com/huikan?id=10 即可自动生效

脚本会自动：
- 注入 CSS 隐藏 `.image-mask`
- 拦截 XHR / fetch API，修改版权字段
- 找到 Vue 组件打补丁，初始化播放器
- 拦截试看倒计时、标签页切换暂停等

---

### 方式三：PowerShell 自动化脚本（全自动，无需浏览器插件，强烈推荐，可以开干净的直播窗口全屏看）

双击 `run.bat`，脚本会自动：
1. 打开 Edge 浏览器并启动远程调试端口
2. 通过 CDP（Chrome DevTools Protocol）注入 JS，绕过版权限制
3. 提取 HLS 流地址（m3u8）
4. 打开 `player.html` 在新标签播放
5. **每 35 分钟自动刷新**（token 约 1 小时过期）

```bat
# 只需一步
run.bat
```

**工作流：**

```
run.bat
  └→ kankanews-bypass.ps1
        ├→ 启动 Edge（--remote-debugging-port=19222）
        ├→ 导航到 https://live.kankanews.com/huikan?id=10
        ├→ 等待页面加载（5s）
        ├→ CDP WebSocket 注入 JavaScript:
        │    1. 找到 Vue 组件 HuikanIndex
        │    2. 修复版权字段（is_shield / is_review / can_review）
        │    3. 恢复 live_address + 关闭 isCopyright 开关
        │    4. 调 initPlayer()
        ├→ 等待流加载（6s）
        ├→ 从 performance 日志提取 m3u8 URL
        ├→ 用 Edge 打开 player.html#URL（URL 放 hash 里）
        └→ 每 35 分钟循环: 重新 bypass → 提新 URL → 开新播放器

player.html
  └→ 读取 location.hash 里的 m3u8 URL
  └→ hls.js 解码播放
  └→ 粘贴/复制/刷新按钮（手动备用）
```

**数据流：** `.bat` → `.ps1` → CDP 操作 Edge → 取 m3u8 → 开 `.html#URL` → hls.js 播

**原理：** PowerShell 用 C# 的 `ClientWebSocket` 连接 Edge 的 CDP WebSocket 接口，通过 `Runtime.evaluate` 在页面上下文中执行 JavaScript（修复 `is_shield` 等版权字段 → 恢复 `live_address` → 关闭 `isCopyright` → 调用 `initPlayer()` → 从 `performance.getEntriesByType('resource')` 提取 m3u8 URL）。

**要求：** Windows + Edge/Chrome，无需安装任何额外软件。

---

- ✅ **Edge** / **Chrome** 最新版
- ✅ **Tampermonkey** / **Violentmonkey**
- ⚠️ Firefox 理论兼容，未充分测试
- ❌ Safari 未测试
- 📱 移动端：Android 上安装支持 Tampermonkey 的浏览器（如 Kiwi Browser），同样可用

---

## License

MIT

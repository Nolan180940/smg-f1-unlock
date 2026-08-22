# 收看五星体育 / SMG 电视频道

打开 [看看新闻](https://live.kankanews.com/huikan?id=10) 看五星体育等 SMG 频道时，F1 等版权节目会显示 **"版权受限"**。本项目绕过此限制，并支持节目回放。

---

## 使用方法

### ① Tampermonkey 脚本（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器插件
2. 点击图标 → **创建新脚本** → 粘贴 [`smg_fivestar.user.js`](./smg_fivestar.user.js) 全部内容 → **Ctrl+S** 保存
3. 打开 [看看新闻](https://live.kankanews.com/huikan?id=10) 即可自动生效

**功能：**
- ✅ 绕过版权限制（`is_shield` / `is_review` / `copyright_image`）
- ✅ 直播 + 回放（点击左侧历史节目即可回看，支持进度条拖动）
- ✅ 拦截试看倒计时、标签页切换暂停
- ✅ SPA 路由切换自动重新打补丁
- ✅ Safari / Stay 兼容

> 脚本 v0.17，详见 [`smg_fivestar.user.js`](./smg_fivestar.user.js)

---

### ② Console 粘贴

不想装插件？直接在浏览器 Console 里粘贴代码。

1. 打开 [看看新闻](https://live.kankanews.com/huikan?id=10)，等页面加载完成
2. 按 **F12** → **Console** → 粘贴代码 → 回车
3. 看到 `✅ 已就绪` 即可使用

**两个模式：**

| 模式 | 功能 | 代码 |
|------|------|------|
| **A. 直播 + 回放**（推荐） | 绕过版权 + 点击历史节目回放 + 进度条拖动 | [`CONSOLE.md` 模式 A](./CONSOLE.md#模式-a直播--回放v017推荐) |
| **B. 仅直播** | 仅绕过版权限制看直播 | [`CONSOLE.md` 模式 B](./CONSOLE.md#模式-b仅直播精简版不含回放) |

> ⚠️ 刷新页面后需要重新粘贴。详见 [`CONSOLE.md`](./CONSOLE.md)

---

### ③ PowerShell 自动化（未更新，仅直播）

双击 [`run.bat`](./run.bat)，脚本会自动打开 Edge 并通过 CDP 注入 JS 绕过版权限制。

> ⚠️ **暂不支持回放**，仅直播。回放请使用上方两种方式。

---

## 工作原理

### 直播绕过

看看新闻是 Nuxt.js（Vue 2）应用，服务端返回 `is_shield=1` + `copyright_image` 版权遮罩。前端据此拦截播放器初始化。

**绕过步骤：**
1. 隐藏 `.image-mask` 遮罩图
2. 修改 Vue 数据：`is_shield=0`、`is_review=1`、`can_review=1`、清空 `copyright_image`
3. 恢复 `live_address`（从频道接口复制到节目详情）
4. 关闭 `isCopyright` 开关，调用 `initPlayer()`

### 回放原理

看看新闻的 CDN（字节跳动 volc-stream）**支持时间偏移**，只是前端没有用。

在直播流 URL 后加 `&startTime=UNIX_TIMESTAMP`，CDN 就返回该时间点的 HLS 流（最近 5 分钟 ~ 12 小时有效）。

```
直播流: .../index.m3u8?token=xxx&volcSecret=xxx&volcTime=xxx
回放流: .../index.m3u8?token=xxx&volcSecret=xxx&volcTime=xxx&startTime=1787330880
```

**回放流程：**
```
点击回放节目 → 从直播流提取 token → 拼接 &startTime 构建偏移 URL
    → new $xgplayer() 创建回放播放器
    → Hook manifestLoader.load(): 每次轮询动态更新 startTime = 节目起点 + 播放位置
    → 覆写 player.seek(): 拖动进度条时用 switchURL() 真切源
    → 虚拟位置追踪器独立维护节目内位置（offsetCurrentTime）
```

**关键技术点：**
- CDN shift manifest 返回固定 3 个分片（~30s），必须动态更新 `startTime` 防冻结
- `player.switchURL()` 做完整 HLS 源切换（清旧缓冲 + 加载新 manifest）
- `Object.defineProperty` 锁定 `offsetCurrentTime` 防止 HLS 插件重置
- 150ms 防抖 + Promise 队列防止拖拽竞态

---

## 常见问题

| 问题 | 现象 | 解决方案 |
|------|------|---------|
| **iOS 跳转手机版** | 访问后跳到 `m.kankanews.com`，页面 404 | Safari 地址栏 → 点 `aA` → **"请求桌面网站"**。或 iPhone 设置 → Safari → 请求桌面网站 → 加入 `kankanews.com` |
| **手机端无限跳转** | 页面在 `m.` 和 `live.` 之间疯狂闪烁 | v0.15 已用 `replaceState` 修复。配合"请求桌面网站"效果最佳 |
| **回放加载慢/无画面** | 点击回放后转圈但无画面 | 回放支持 5 分钟 ~ 12 小时内的节目。超过 12 小时不支持 |
| **Tampermonkey 不生效** | 脚本已安装但页面无变化 | 检查：① 脚本开关是否打开 ② 是否被当前站点禁用 ③ Console 有无 `[SMGTV]` 日志 |
| **`initPlayer()` 报错** | 控制台 "Cannot read property of undefined" | 等页面完全加载后再运行。Console 方式看 `[SMGTV] Vue found` 日志；Tampermonkey 方式会自动重试 |
| **版权遮罩图仍显示** | `.image-mask` 未被隐藏 | 网站可能改了 class 名。DevTools → Elements → 搜索 `copyright`，找到新 class 加入 CSS |
| **Stay 注入无效** | 无 `[SMGTV]` 日志 | Stay 脚本设置 → 注入方式 → 改为 **Page**（非 Auto / Content） |
| **回放 30 秒冻结** | 播放 30 秒后卡住 | v0.17 已修复。动态 `startTime` + `switchURL` 切源 |
| **E.a 解密空 URL** | `live_address` 解密后为空 | v0.13+ 回放已绕过此问题，直接从直播流提取 token 构建偏移 URL |

---

## 兼容性

| 平台 | 直播 | 回放 | 备注 |
|------|------|------|------|
| **Windows** Edge / Chrome | ✅ | ✅ | 已测试 |
| **macOS** Safari（Stay） | ✅ | ✅ | 已测试，需开启"请求桌面网站" |
| **iOS** Safari（Stay） | ✅ | ✅ | 已测试，必须开启"请求桌面网站" |
| **Android** Kiwi Browser + Tampermonkey | ✅ | ✅ | 理论兼容 |
| **Firefox** | ⚠️ | ⚠️ | 未测试 |
| **PowerShell (run.bat)** | ✅ | ❌ | 仅直播，未更新回放功能 |

---

## License

[MIT](./LICENSE)

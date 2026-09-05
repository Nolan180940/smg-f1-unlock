# 收看五星体育 / SMG 电视频道

打开 [看看新闻](https://live.kankanews.com/huikan?id=10) 看五星体育等 SMG 频道时，F1 等版权节目会显示 **"版权受限"**。本项目绕过此限制，并支持节目回放。

---

## 使用方法

### ① Tampermonkey 脚本（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器插件
2. 点击 → [安装脚本](https://github.com/Nolan180940/smg-f1-unlock/raw/refs/heads/master/smg_fivestar.user.js)
3. 打开 [看看新闻](https://live.kankanews.com/huikan?id=10) 即可自动生效

**功能：**
- ✅ 绕过版权限制（`is_shield` / `is_review` / `copyright_image`）
- ✅ 直播（打开页面自动播放当前节目，token 过期自动刷新不断流）
- ✅ 回放（点击左侧历史节目即可回看，支持进度条拖动）
- ✅ 拦截试看倒计时、标签页切换暂停
- ✅ SPA 路由切换自动重新打补丁
- ✅ Safari / Stay 兼容

> 当前版本 v0.19，详见 [`smg_fivestar.user.js`](./smg_fivestar.user.js)

---

### ② Console 粘贴

不想装插件？直接在浏览器 Console 里粘贴代码。

1. 打开 [看看新闻](https://live.kankanews.com/huikan?id=10)，等页面加载完成
2. 按 **F12** → **Console** → 粘贴代码 → 回车
3. 看到 `✅ 已就绪` 即可使用

**两个模式：**

| 模式 | 功能 | 代码 |
|------|------|------|
| **A. 直播 + 回放**（推荐） | 打开即播当前直播（token 自动刷新）+ 点击历史节目回放 + 进度条拖动 | [`CONSOLE.md` 模式 A](./CONSOLE.md#模式-a直播--回放v019推荐) |
| **B. 仅直播** | 备用精简版（不再使用，v0.18 起服务端已清空流地址，仅其他频道可用，五星体育F1直播模式B不可用，仅为其他频道保留备用） | [`CONSOLE.md` 模式 B](./CONSOLE.md#模式-b仅直播精简版不含回放) |

> 当前版本 v0.19。⚠️ 刷新页面后需要重新粘贴。详见 [`CONSOLE.md`](./CONSOLE.md)

---

## 常见问题

| 问题 | 现象 | 解决方案 |
|------|------|---------|
| **iOS 跳转手机版** | 访问后跳到 `m.kankanews.com`，页面 404 或者依旧有版权限制 | Safari 地址栏 → 点 `aA` → **"请求桌面网站"**（这是最需要注意的，因为手机版和桌面版网页架构不一样，这是你最有可能遇到的问题）。或 iPhone 设置 → Safari → 请求桌面网站 → 加入 `kankanews.com` |
| **手机端无限跳转** | 页面在 `m.` 和 `live.` 之间疯狂闪烁 | v0.15 已用 `replaceState` 修复。配合"请求桌面网站"效果最佳 |
| **回放加载慢/无画面** | 点击回放后转圈但无画面 | 回放支持 一周 内的节目 |
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

---

## License

[MIT](./LICENSE)

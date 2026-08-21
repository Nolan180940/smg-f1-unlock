# 收看五星体育 / SMG 电视频道（绕过版权限制 + 回放）

打开 [看看新闻](https://live.kankanews.com/huikan?id=10) 看五星体育等 SMG 频道时，F1 等版权节目会显示：

> **"版权受限，此时段不提供电视网络转播服务"**

这是因为服务端返回的节目数据中 `is_shield=1`，且频道带有 `copyright_image` 版权遮罩图，前端据此拦截播放。

本项目提供**绕过版权限制**和**节目回放**两种能力。

---

## 目录

- [为什么看不了？](#为什么看不了)
- [绕过原理（直播）](#绕过原理直播)
- [回放原理](#回放原理v013)
- [方式一：Console 粘贴（推荐）](#方式一console-粘贴推荐)
- [方式二：Tampermonkey 脚本](#方式二tampermonkey-脚本)
- [方式三：PowerShell 自动化脚本](#方式三powershell-自动化脚本)
- [兼容性](#兼容性)
- [License](#license)

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

## 绕过原理（直播）

1. **隐藏 `.image-mask`** — 把版权遮罩图藏掉
2. **修改 Vue 组件数据** — 把 `is_shield` 改成 `0`，`is_review` / `can_review` 改成 `1`，清空 `copyright_image`
3. **绕过 `isCopyright` 开关** — 网站在 Vue 组件上加了 `isCopyright` 计算属性，为真时 `initPlayer()` 才会创建播放器
4. **恢复流地址** — 服务端不再把 `live_address` 放进节目详情接口，需要从频道接口复制回来
5. **手动调用 `initPlayer()`** — 触发播放器初始化，解密 `live_address` 并加载 HLS 视频流

---

## 回放原理 (v0.13)

### 发现：CDN 支持时间偏移

看看新闻的直播 CDN（字节跳动 volc-stream）**支持时间偏移**，只是前端没有用。

正常的直播流 URL：
```
https://volc-stream.kksmg.com/live/dfws4k/index.m3u8?token=eyJ...&volcSecret=...&volcTime=...
```

只需在后面加一个 `&startTime=1787330880`（Unix 时间戳），CDN 就返回**那个时间点**的 HLS 流：

```
https://volc-stream.kksmg.com/live/dfws4k/index.m3u8?token=eyJ...&volcSecret=...&volcTime=...&startTime=1787330880
```

| 测试时间范围 | 结果 |
|-------------|------|
| 5 分钟前 | ✅ 有效 |
| 1 小时前 | ✅ 有效 |
| 6 小时前 | ✅ 有效 |
| 12 小时前 | ✅ 有效（测试上限） |

偏移流的 manifest 特征：
- `#EXT-X-VERSION:6`（正常流为 `#EXT-X-VERSION:3`）
- 每个分段 ~10 秒，manifest 返回 3 个分段（~30 秒）
- HLS.js 自动轮询 manifest 获取后续分段，连续播放
- 分段名格式：`10000-{timestamp}-{x}-{seq}.ts?shift=true&sign=false`

### 难点：为什么不能直接用 `initPlayer`？

网站的 `initPlayer` 内部有这行代码：

```js
_ = Object(E.a)(y)   // E.a = webpack 模块 560，RSA 解密函数（JSEncrypt）
```

- 对加密的 `live_address`（Base64 密文）→ 正确解密为完整 URL ✅
- 对我们的明文 shift URL → **解密失败，返回空字符串** ❌

播放器拿到空 URL 就不播了。

### 解决方案

**绕过 `initPlayer`，直接用 `new $xgplayer()` 创建播放器**：

```
用户点击回放节目
    ↓
从现有直播播放器获取已解密的 URL（含 token、volcSecret、volcTime）
    ↓
拼接 &startTime={节目的 start_time} 构建偏移 URL
    ↓
new $xgplayer({ url: 偏移URL, isLive: false, plugins: [HLS] })
    ↓
播放器加载偏移流 → 回放开始
```

---

## 快速开始

### 方式一：Console 粘贴（推荐）

#### A. 直播 + 回放（完整版，v0.13）

1. 用 Edge / Chrome 打开 https://live.kankanews.com/huikan?id=10
2. 等页面加载完成（几秒）
3. 按 **F12** → **Console** 标签 → 粘贴以下代码 → 回车：

```js
// SMGTV 直播 + 回放 — Console 版 (v0.13)
(function(){
    var v=document.querySelector('.huikan').__vue__;
    if(!v){console.error('[SMGTV] 未找到Vue组件');return}

    // ===== 1. 修补版权字段 =====
    function fix(o){if(!o)return;o.is_shield=0;o.is_review=1;o.can_review=1}
    fix(v.programObj);fix(v.programDetail);fix(v.playingProgramObj);
    if(Array.isArray(v.programList))v.programList.forEach(fix);
    if(Array.isArray(v.currentProgramList))v.currentProgramList.forEach(fix);
    if(v.currChannelDetail){v.currChannelDetail.copyright_image=''}
    if(v.currChannel){v.currChannel.copyright_image=''}
    if(v.currChannelDetail&&v.currChannelDetail.live_address){
        v.programDetail=v.programDetail||{};
        v.programDetail.channel_info=v.programDetail.channel_info||{};
        v.programDetail.channel_info.live_address=v.currChannelDetail.live_address;
    }
    v.isCopyright=false;
    var m=document.querySelector('.image-mask');if(m)m.style.display='none';
    v.$forceUpdate();

    // ===== 2. 启动直播播放器 =====
    if(!v.player){try{v.initPlayer();}catch(e){}}

    // ===== 3. 获取直播流URL并提取token =====
    var liveUrl=v.player&&v.player.config&&v.player.config.url;
    if(!liveUrl){console.error('[SMGTV] 播放器未启动，请等直播加载后再试');return}
    var u=new URL(liveUrl);
    var token=u.searchParams.get('token');
    var volcSecret=u.searchParams.get('volcSecret');
    var volcTime=u.searchParams.get('volcTime');
    var stream=u.pathname.match(/\/live\/([^/]+)\//)[1];

    // ===== 4. 构建偏移URL的函数 =====
    function makeShift(ts){
        return 'https://volc-stream.kksmg.com/live/'+stream
            +'/index.m3u8?token='+token
            +'&volcSecret='+volcSecret
            +'&volcTime='+volcTime
            +'&startTime='+ts;
    }
    window.makeShift=makeShift;

    // ===== 5. 绕过initPlayer，直接创建回放播放器 =====
    var origInit=v.initPlayer;
    v.initPlayer=function(){
        var p=v.programObj;
        if(p&&p.play===0&&p.start_time){
            try{
                var url=makeShift(p.start_time);
                console.log('[SMGTV] [回放] 正在播放:',p.name,'时间戳:',p.start_time);
                v.destroyPlayer();
                var vol=Number(localStorage.getItem('playerVolume'))||0.5;
                v.player=new v.$xgplayer({
                    el:v.$refs.livePlayer,
                    url:url,
                    isLive:false,
                    fluid:true,
                    crossOrigin:true,
                    controls:true,
                    volume:vol,
                    playbackRate:[2,1.5,1.25,1,.75,.5],
                    ignores:['cssFullscreen'],
                    keyShortcut:true,
                    lang:'zh-cn',
                    closeVideoClick:true,
                    plugins:[v.$hlsPlayer]
                });
                v.player.muted=v.isMuted;
                v.player.on('canplay',function(){v.isLoading=false});
                v.player.on('ended',function(){
                    if(v.programObj.play===0&&v.playNextProgram)v.playNextProgram()
                });
                setTimeout(function(){v.player.play()},200);
                return;
            }catch(e){console.error('[SMGTV] [回放] 失败:',e)}
        }
        return origInit.apply(this,arguments);
    };

    console.log('[SMGTV] ✅ 已就绪！直播正常播放中');
    console.log('[SMGTV] 👉 点击左侧节目列表中的历史节目即可回放');
    console.log('[SMGTV] 👉 或在Console输入 makeShift(时间戳) 获取回放URL');
})();
```

4. 看到 `✅ 已就绪` 后，**点击左侧节目列表里的任意回放节目**即可观看。

> ⚠️ 刷新页面后需要重新粘贴。切换频道不受影响。

#### 手动指定时间点

粘贴上面的代码后，可以在 Console 输入：

```js
// 看1小时前的内容
v.destroyPlayer();
v.player=new v.$xgplayer({
    el:v.$refs.livePlayer,
    url:makeShift(Date.now()/1000-3600),
    isLive:false,fluid:true,
    plugins:[v.$hlsPlayer]
});
v.player.play();

// 看30分钟前
// makeShift(Date.now()/1000 - 1800)

// 看6小时前
// makeShift(Date.now()/1000 - 21600)
```

`makeShift(时间戳)` 也会返回完整的回放 URL，可以复制到其他播放器使用。

---

#### B. 仅直播（精简版，不含回放）

如果只需要绕过版权限制看直播，不需要回放，用这段更短的代码：

```js
var v=document.querySelector('.huikan').__vue__;
function f(o){if(!o)return;o.is_shield=0;o.is_review=1;o.can_review=1}
f(v.programObj);f(v.programDetail);f(v.playingProgramObj);
if(v.currChannelDetail){v.currChannelDetail.copyright_image='';v.currChannelDetail.live_shift=0}
if(v.currChannel){v.currChannel.copyright_image='';v.currChannel.live_shift=0}
if(v.currChannelDetail&&v.currChannelDetail.live_address){
  v.programDetail.channel_info=v.programDetail.channel_info||{};
  v.programDetail.channel_info.live_address=v.currChannelDetail.live_address}
v.isCopyright=false;
var m=document.querySelector('.image-mask');if(m)m.style.display='none';
v.$forceUpdate();
try{v.initPlayer();}catch(e){}
```

---

### 方式二：Tampermonkey 脚本

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器插件
2. 点击 Tampermonkey 图标 → **创建新脚本**
3. 把 `smg_fivestar.user.js` 的全部内容粘贴进去
4. **Ctrl+S 保存**
5. 打开 https://live.kankanews.com/huikan?id=10 即可自动生效

脚本会自动：
- ✅ 绕过版权限制（`is_shield` / `is_review` / `copyright_image`）
- ✅ 恢复流地址 + 绕过 `isCopyright` 开关
- ✅ 初始化直播播放器
- ✅ **点击回放节目自动切换到回放流**（v0.13 新增）
- ✅ 拦截试看倒计时、标签页切换暂停
- ✅ SPA 路由切换自动重新打补丁
- ✅ Safari / Stay 兼容

> 脚本 v0.13 已内置回放支持，点击左侧任何历史节目即可回放。
>
> ⚠️ 目前 `run.bat`（PowerShell 方式）暂不支持回放，Console 和 Tampermonkey 均可用。

---

### 方式三：PowerShell 自动化脚本

> ⚠️ 此方式**暂不支持回放**，仅支持直播。回放请使用 Console 或 Tampermonkey。

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

## 兼容性

| 浏览器 | 直播 | 回放 | 备注 |
|--------|------|------|------|
| Edge / Chrome 最新版 | ✅ | ✅ | 推荐 |
| Tampermonkey / Violentmonkey | ✅ | ✅ | 脚本方式 |
| Firefox | ⚠️ | ⚠️ | 理论兼容，未充分测试 |
| Safari | ⚠️ | ⚠️ | Stay 插件兼容，未充分测试 |
| 移动端 Android | ✅ | ✅ | Kiwi Browser 等支持 Tampermonkey 的浏览器 |
| PowerShell (run.bat) | ✅ | ❌ | 暂不支持回放 |

---

## License

MIT

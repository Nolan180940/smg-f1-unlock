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
- [已知问题与解决方案](#已知问题与解决方案)
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

## 回放原理 (v0.17)

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
- **CDN shift 是静态的**：相同 `startTime` 永远返回相同的3个分片，不是滑动窗口
- 分段名格式：`10000-{timestamp}-{x}-{seq}.ts?shift=true&sign=false`

### 难点 1：为什么不能直接用 `initPlayer`？

网站的 `initPlayer` 内部有这行代码：

```js
_ = Object(E.a)(y)   // E.a = webpack 模块 560，RSA 解密函数（JSEncrypt）
```

- 对加密的 `live_address`（Base64 密文）→ 正确解密为完整 URL ✅
- 对我们的明文 shift URL → **解密失败，返回空字符串** ❌

播放器拿到空 URL 就不播了。

### 难点 2：30 秒冻结问题（v0.17 修复）

**根因**：CDN shift manifest 返回**固定的3个分片**（~30秒），不是滑动窗口。

```
HLS.js 加载 shift manifest → 获取3个分片（30秒）→ 播放完
    ↓
HLS.js poll 重新请求同一 URL（startTime 不变）
    ↓
CDN 返回完全相同的3个分片 → 无新内容 → ❌ 卡住
```

**验证**：向 CDN 发3次相同 `startTime` 请求，返回的 `mediaSequence` 完全相同：

| 请求次数 | startTime | mediaSequence | 结果 |
|----------|-----------|---------------|------|
| 第1次 | 1787403877 | 1786649705 | 3 segments |
| 第2次 | 同上 | **1786649705** | 完全相同 |
| 第3次 | 同上 | **1786649705** | 完全相同 |
| 第4次（+50s） | 1787403927 | **1786649710** | 不同 ✅ |

**解决方案**：每次 HLS.js 轮询 manifest 时，**动态更新 `startTime`**：

```
newStartTime = programStartTime + player.currentTime
```

这样每次 poll 都能拿到**新的3个分片**，实现无限续播。

### 解决方案

**绕过 `initPlayer`，直接用 `new $xgplayer()` 创建播放器 + 动态 startTime hook**：

```
用户点击回放节目
    ↓
从现有直播播放器获取已解密的 URL（含 token、volcSecret、volcTime）
    ↓
拼接 &startTime={节目的 start_time} 构建偏移 URL
    ↓
new $xgplayer({ url: 偏移URL, isLive: false, plugins: [HLS] })
    ↓
Hook manifestLoader.load(): 虚拟位置追踪器 (_virtualPos)
    ├── 正常 poll: startTime = programStart + _virtualPos（每秒自动推进）
    └── 用户寻道: _virtualPos = seek目标（覆写 player.seek() 捕获）
    ↓
播放器加载偏移流 → 回放开始 → 无限续播 ✅
    ↓
用户拖动进度条 → player.seek() 覆写 → switchURL 完整切换目标分片 → _virtualPos 保持节目位置
```

---

## 快速开始

### 方式一：Console 粘贴（推荐）

#### A. 直播 + 回放（完整版，v0.17）

1. 用 Edge / Chrome 打开 https://live.kankanews.com/huikan?id=10
2. 等页面加载完成（几秒）
3. 按 **F12** → **Console** 标签 → 粘贴以下代码 → 回车：

```js
// SMGTV 直播 + 回放 — Console 版 (v0.17)
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

    // ===== 5. 绕过initPlayer，直接创建回放播放器（v0.17: 动态 startTime + 真正切源寻道） =====
    var origInit=v.initPlayer;
    v.initPlayer=function(){
        var p=v.programObj;
        if(p&&p.play===0&&p.start_time){
            try{
                var url=makeShift(p.start_time);
                var pStart=p.start_time;
                var pEnd=p.end_time||(pStart+7200);
                console.log('[SMGTV] [回放] 正在播放:',p.name,'时间戳:',pStart);
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

                // --- Hook manifest loader: 虚拟位置追踪 + 动态 startTime 防30秒冻结 ---
                (function hookML(){
                    var n=0;var t=setInterval(function(){
                        n++;var hls=v.player.plugins&&v.player.plugins.hls&&v.player.plugins.hls.hls;
                        if(!hls||!hls._manifestLoader){if(n>20)clearInterval(t);return}
                        clearInterval(t);
                        var ml=hls._manifestLoader;var ol=ml.load.bind(ml);

                        // 虚拟位置追踪: 不依赖 player.currentTime (HLS.js会重置它)
                        var _vPos=0,_vTs=Date.now(),_seeking=false,_hasSeek=false,_seekGen=0,_seekTmr=null,_seekQueue=Promise.resolve();
                        try{Object.defineProperty(v.player,'offsetCurrentTime',{get:function(){return _vPos},set:function(){},configurable:true,enumerable:true})}catch(e){}
                        function clamp(pos){pos=Number(pos);if(!isFinite(pos))return 0;return Math.max(0,Math.min(pEnd-pStart,pos))}
                        function publish(){v.player.offsetCurrentTime=_vPos}
                        // 每0.5秒推进虚拟位置 (播放中)
                        setInterval(function(){
                            if(!v.player.paused&&!_seeking){
                                var now=Date.now();_vPos=clamp(_vPos+(now-_vTs)/1000);_vTs=now;publish();
                            }else{_vTs=Date.now()}
                        },500);
                        // 首次寻道前，媒体相对时间可同步到节目时间
                        // 从 currentTime 同步 (正常播放时)
                        setInterval(function(){
                            if(!v.player.paused&&!_seeking&&!_hasSeek){
                                _vPos=clamp(v.player.currentTime);_vTs=Date.now();publish();
                            }
                        },1000);
                        publish();

                        // 覆写 player.seek() — 仅用户拖动进度条时触发
                        v.player.seek=function(time){
                            var target=clamp(time),ts=Math.floor(pStart+target),gen=++_seekGen,wasPaused=v.player.paused;
                            _vPos=target;_vTs=Date.now();_seeking=true;_hasSeek=true;publish();
                            if(_seekTmr)clearTimeout(_seekTmr);
                            console.log('[SMGTV] [回放] Seek目标→',ts,'pos:',target.toFixed(1)+'s');
                            _seekTmr=setTimeout(function(){
                                var finalTarget=_vPos,finalTs=Math.floor(pStart+finalTarget),finalGen=_seekGen;
                                _seekQueue=_seekQueue.catch(function(){}).then(function(){
                                    if(finalGen!==_seekGen)return;
                                    var url=makeShift(finalTs);
                                    if(!url||typeof v.player.switchURL!=='function'){
                                        console.error('[SMGTV] [回放] switchURL不可用');_seeking=false;return;
                                    }
                                    console.log('[SMGTV] [回放] 切换目标分片→',finalTs,'pos:',finalTarget.toFixed(1)+'s');
                                    return Promise.resolve(v.player.switchURL(url,{seamless:false,currentTime:0})).then(function(){
                                        if(finalGen!==_seekGen)return;
                                        _seeking=false;_vTs=Date.now();publish();
                                        if(wasPaused)v.player.pause();else v.player.play();
                                        console.log('[SMGTV] [回放] 切源完成，节目位置:',_vPos.toFixed(1)+'s');
                                    }).catch(function(e){
                                        if(finalGen!==_seekGen)return;
                                        _seeking=false;console.error('[SMGTV] [回放] 切源失败:',e);
                                    });
                                });
                            },150);
                        };

                        // manifestLoader.load: 正常轮询仍使用虚拟节目位置
                        ml.load=function(url){
                            if(typeof url==='string'&&url.indexOf('startTime=')!==-1){
                                var ts=Math.floor(pStart+_vPos);
                                url=url.replace(/startTime=\d+/,'startTime='+ts);
                                console.log('[SMGTV] [回放] startTime→',ts,'vPos:',_vPos.toFixed(1)+'s');
                            }
                            return ol(url);
                        };
                        // 进度条总时长
                        var dur=pEnd-pStart;
                        Object.defineProperty(v.player.video,'duration',{get:function(){return dur},configurable:true});
                        v.player._duration=dur;
                        console.log('[SMGTV] [回放] 时长:',dur+'s ('+(dur/60).toFixed(1)+' min)');
                    },200);
                })();

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
    console.log('[SMGTV] 👉 点击左侧节目列表中的历史节目即可回放（v0.17 支持进度条拖动）');
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
if(!v){console.error('未找到Vue组件');return}
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

> 脚本 v0.17 已内置回放支持（含真实切源和进度条拖动），点击左侧任何历史节目即可回放。
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
| Safari (Stay) | ⚠️ | ⚠️ | 需开启"请求桌面网站"（见下方） |
| iOS Safari (Stay) | ⚠️ | ⚠️ | 必须开启"请求桌面网站"，否则重定向到手机版 404 |
| 移动端 Android | ✅ | ✅ | Kiwi Browser 等支持 Tampermonkey 的浏览器 |
| PowerShell (run.bat) | ✅ | ❌ | 暂不支持回放 |

---

## 已知问题与解决方案

### 1. 🔴 iOS Safari / Stay：必须开启"请求桌面网站"

**现象：** 访问 `live.kankanews.com/huikan?id=10` 后被自动跳转到 `m.kankanews.com/huikan/10`，页面 404 或版权提示仍在。

**原因：** 看看新闻服务器检测到手机 User-Agent 后，强制将用户从 `live.kankanews.com`（桌面版）跳转到 `m.kankanews.com`（手机版）。手机版使用完全不同的前端框架，没有脚本依赖的 Vue 组件（`.huikan`、`HuikanIndex`），因此脚本无法工作。

**解决方案（任选其一）：**

- **推荐：** Safari 地址栏输入网址前，长按地址栏 → 点 `aA` → **"请求桌面网站"**
- **一劳永逸：** iPhone 设置 → Safari → 请求桌面网站 → 把 `kankanews.com` 加入白名单
- 这样服务器就不会跳到手机版，脚本正常工作

> ⚠️ 脚本内的 `replaceState` 修复只能改 URL 不刷新页面，但手机版页面本身没有正确的 Vue 组件，所以光改 URL 不够——必须用桌面版。

---

### 3. 🔴 无限重定向循环（手机端疯狂抽搐）

**现象：** 在手机上访问页面后，页面在 `m.kankanews.com` 和 `live.kankanews.com` 之间疯狂跳转闪烁。

**原因：** 脚本检测到 `m.kankanews.com` 后用 `location.replace()` 跳回 `live.kankanews.com`，但服务器又把手机 UA 跳回 `m.kankanews.com`，形成死循环。

**解决方案：** 已在 v0.15 中改用 `history.replaceState()` 就地修复 URL，不触发页面导航，彻底避免循环。配合方案 1（请求桌面网站）效果最佳。

---

### 4. 🟡 版权遮罩图 `.image-mask` 无法隐藏

**现象：** CSS `display:none` 没有效果，遮罩图仍然显示。

**原因：** 网站可能在后续更新中修改了遮罩图的 class 名（如 `.copyright-mask`、`.video-overlay` 等）。

**解决方案：** 打开浏览器 DevTools → Elements → 搜索 `copyright` 或 `shield`，找到新的 class 名，在脚本的 CSS 注入部分加上对应的 `display:none!important`。

---

### 5. 🟡 `initPlayer()` 报错 "Cannot read property of undefined"

**现象：** 控制台报错，播放器无法启动。

**原因：** 脚本运行时 Vue 组件尚未完全初始化（`programObj` 或 `channel_info` 还是空的），或 `live_address` 为空（服务端未返回）。

**解决方案：**
- 等页面完全加载后再运行脚本（看控制台是否有 `[SMGTV] Vue found` 日志）
- 如果是 Console 方式，确认先执行了版权修复代码，再调用 `initPlayer()`
- 如果是 Tampermonkey 方式，脚本会自动重试（最多 30 次）

---

### 6. 🟡 Tampermonkey 脚本不生效

**现象：** 脚本已安装并启用，但页面没有任何变化。

**排查步骤：**
1. 点击 Tampermonkey 图标 → 确认脚本开关是**打开**的
2. 点击脚本名称 → 确认没有被**当前站点禁用**
3. 按 F12 → Console → 看是否有 `[SMGTV]` 开头的日志
4. 如果没有任何 `[SMGTV]` 日志，检查 `@match` 是否匹配当前 URL

---

### 7. 🟡 回放偏移流加载慢或无画面

**现象：** 点击回放节目后，播放器转圈但没有画面。

**原因：** volc-stream CDN 的偏移流需要一定时间生成，如果 `startTime` 距离当前时间太久远（如超过 12 小时），CDN 可能不支持。

**解决方案：**
- 回放功能支持最近 **5 分钟 ~ 12 小时** 内的节目
- 如果是 F1 等时效性很强的节目，建议在赛后尽快回看
- 超过 12 小时的节目建议通过看看新闻 App 的"往期回看"功能
- v0.17 已修复30秒冻结和寻道画面不同步问题，回放可持续播放到节目结束

---

### 8. 🟡 E.a RSA 解密导致空 URL

**现象：** 控制台日志显示 `live_address` 解密后变为空字符串。

**原因：** `live_address` 有两种格式：加密的（需要 RSA 解密）和明文的（已经是完整 URL）。`patchModule560()` 中的 monkey-patch 对明文 URL 会返回空字符串。

**解决方案：** v0.13+ 的回放功能已绕过此问题——对于过去的节目（`play===0`），不再依赖 `initPlayer()` 的解密流程，而是直接从直播播放器提取 token，构建偏移 URL。

---

### 9. 🟡 Stay 注入方式问题

**现象：** 脚本运行了但找不到 Vue 对象，控制台没有 `[SMGTV] Vue found` 日志。

**原因：** Stay 默认使用 Content Script 注入方式，脚本运行在隔离的上下文中，无法访问页面的 `__vue__` 对象。

**解决方案：** Stay 脚本设置 → 注入方式 → 改为 **Page**（非 Auto / Content）。

---

### 10. 🔴 回放30秒后冻结 / 进度条无法拖动（v0.17 已修复）

**现象：** 点击回放节目后，播放30秒后画面卡住不动，进度条只能在0~30秒范围内拖动。

**根因：** CDN shift manifest 返回**固定3个分片**（~30秒），不是滑动窗口。HLS.js 轮询同一 URL 每次拿到相同分片 → 无新内容 → 冻结。

**验证（实测）：**
```
相同 startTime 请求3次 → 返回完全相同的3个分片（mediaSequence 不变）
更新 startTime +50s → 返回不同的分片（mediaSequence 递增）✅
```

**解决方案（v0.17）：**
1. 用虚拟位置追踪器计算节目内位置，不依赖 HLS.js 寻道后会重置的媒体相对时间
2. 覆写 `player.seek()` 捕获进度条目标，并防抖拖动过程中的重复调用
3. 调用站点 HLS 内核的 `player.switchURL(url, {seamless:false, currentTime:0})`，完整清理旧缓冲并加载目标分片
4. 用 `offsetCurrentTime` 保持进度条显示节目内位置，并用 `video.duration` 显示节目总时长

---

## License

MIT

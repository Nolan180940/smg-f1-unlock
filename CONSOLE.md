# Console 粘贴代码

> 不想装插件？直接在浏览器 Console 里粘贴代码即可。

## 使用方法

1. 用 Edge / Chrome 打开 [看看新闻](https://live.kankanews.com/huikan?id=10)
2. 等页面加载完成（几秒）
3. 按 **F12** → **Console** 标签 → 粘贴代码 → 回车
4. 看到 `✅ 已就绪` 即可使用

> ⚠️ 刷新页面后需要重新粘贴。切换频道不受影响。

---

## 模式 A：直播 + 回放（v0.17，推荐）

点击左侧节目列表中的历史节目即可回放，支持进度条拖动。

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

### 手动指定时间点

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

## 模式 B：仅直播（精简版，不含回放）

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

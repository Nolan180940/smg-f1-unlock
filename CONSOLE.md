# Console 粘贴代码

> 不想装插件？直接在浏览器 Console 里粘贴代码即可。

## 使用方法

1. 用 Edge / Chrome 打开 [看看新闻](https://live.kankanews.com/huikan?id=10)
2. 等页面加载完成（几秒）
3. 按 **F12** → **Console** 标签 → 粘贴代码 → 回车
4. 看到 `✅ 已就绪` 即可使用

> ⚠️ 刷新页面后需要重新粘贴。切换频道不受影响。

---

## 模式 A：直播 + 回放（v0.18，推荐）

点击左侧节目列表中的历史节目即可回放，支持进度条拖动。

> v0.18 说明：服务端已清空五星体育的 `live_address`，旧版"从直播播放器 URL 偷 token"已失效。
> 新版改为 token 自举：从当天官方回放节目（`is_review=1`，如《体育新闻》）的 `shift_address`
> 解密出有效 token，CDN 不校验节目版权，任意时间戳均可播放。

```js
// SMGTV 直播 + 回放 — Console 版 (v0.18)
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
    v.isCopyright=false;
    var m=document.querySelector('.image-mask');if(m)m.style.display='none';
    v.$forceUpdate();

    // ===== 2. Token 自举（v0.18） =====
    // 服务端已清空 ch10 live_address，无法再从直播播放器偷 token。
    // 改为：找一个官方回放节目（is_review=1）的 shift_address，RSA 解密出 token。
    var PUB='-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDP5hzPUW5RFeE2xBT1ERB3hHZI\nVotn/qatWhgc1eZof09qKjElFN6Nma461ZAwGpX4aezKP8Adh4WJj4u2O54xCXDt\nwzKRqZO2oNZkuNmF2Va8kLgiEQAAcxYc8JgTN+uQQNpsep4n/o1sArTJooZIF17E\ntSqSgXDcJ7yDj5rc7wIDAQAB\n-----END PUBLIC KEY-----';
    var SECRET='28c8edde3d61a0411511d3b1866f0636',VER='2.42.23';
    var _tok=null;
    function md5(s){ // 精简 MD5（与服务端签名算法一致）
        function rl(n,c){return(n<<c)|(n>>>(32-c))}
        function add(x,y){var l=(x&0xffff)+(y&0xffff),m=(x>>16)+(y>>16)+(l>>16);return(m<<16)|(l&0xffff)}
        function cmn(q,a,b,x,s,t){a=add(add(a,q),add(x,t));return add(rl(a,s),b)}
        function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
        function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
        function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
        function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
        function bl(s){var b=[],m=255;for(var i=0;i<s.length*8;i+=8)b[i>>5]|=(s.charCodeAt(i/8)&m)<<(i%32);return b}
        function hx(b){var h='0123456789abcdef',s='';for(var i=0;i<b.length*4;i++)s+=h.charAt((b[i>>2]>>((i%4)*8+4))&0xf)+h.charAt((b[i>>2]>>((i%4)*8))&0xf);return s}
        s=unescape(encodeURIComponent(s));var x=bl(s);
        x[s.length>>2]|=0x80<<((s.length%4)<<3);x[(((s.length+8)>>6)<<4)+14]=s.length*8;
        var a=1732584193,b=-271733879,c=-1732584194,d=271733878;
        for(var i=0;i<x.length;i+=16){var oa=a,ob=b,oc=c,od=d;
            a=ff(a,b,c,d,x[i],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);
            a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);
            a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);
            a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);
            a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i],20,-373897302);
            a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);
            a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);
            a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);
            a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);
            a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);
            a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);
            a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);
            a=ii(a,b,c,d,x[i],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);
            a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);
            a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);
            a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);
            a=add(a,oa);b=add(b,ob);c=add(c,oc);d=add(d,od)}
        return hx([a,b,c,d])}
    function rsaDec(enc){
        var hex=window.atob(enc).split('').map(function(ch){return('0'+ch.charCodeAt(0).toString(16)).slice(-2)}).join('').toUpperCase();
        var cr=new JSEncrypt();cr.setPublicKey(PUB);var out='';
        for(var p=0;p<hex.length;){var ch=hex.slice(p,p+256);p+=256;
            var by=(ch.replace(/\r|\n/g,'').match(/[\da-fA-F]{2}/g)||[]).map(function(h){return parseInt(h,16)});
            var b64=window.btoa(String.fromCharCode.apply(String,by));if(!b64)continue;
            var mm=cr.decrypt(b64);if(mm)out+=mm}
        return out}
    function signP(ps){var n={platform:'pc',version:VER,nonce:Math.random().toString(36).slice(-8),timestamp:Math.floor(Date.now()/1000),'Api-Version':'v1'};
        var e={},k;for(k in ps)e[k]=ps[k];for(k in n)e[k]=n[k];
        var ks=Object.keys(e).sort(),s='';for(var i=0;i<ks.length;i++)if(e[ks[i]]!=null)s+=ks[i]+'='+e[ks[i]]+'&';
        e.sign=md5(md5(s+SECRET));return e}
    function apiGet(path,ps){var sg=signP(ps||{});ps=ps||{};
        var q=Object.keys(ps).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(ps[k])}).join('&');
        var hd={'Accept':'application/json, text/plain, */*'},k;
        for(k in sg)hd[k]=sg[k];hd['M-Uuid']=localStorage.getItem('uuid')||'';
        return fetch('https://kapi.kankanews.com'+path+(q?'?'+q:''),{headers:hd}).then(function(r){return r.json()})}
    function tokFromUrl(url){try{var u=new URL(url),t=u.searchParams.get('token');if(!t)return null;
        var mt=u.pathname.match(/\/live\/([^/]+)\//);if(!mt)return null;
        var pl=JSON.parse(atob(t.split('.')[1]));
        return{token:t,volcSecret:u.searchParams.get('volcSecret'),volcTime:u.searchParams.get('volcTime'),stream:mt[1],exp:pl.exp||0}}catch(e){return null}}
    function tokValid(t){return!!t&&!!t.token&&(t.exp*1000-Date.now()>5*60*1000)}
    function findDonor(){var ls=[v.programList,v.currentProgramList,v.playingProgramList];
        for(var i=0;i<ls.length;i++){if(!Array.isArray(ls[i]))continue;
            for(var j=0;j<ls[i].length;j++)if(ls[i][j]&&ls[i][j].is_review===1&&ls[i][j].id)return ls[i][j].id}
        return 2215494}
    function ensureTok(cb){
        if(tokValid(_tok)){cb(_tok);return}
        var tried={},q=[],first=findDonor();
        if(first)q.push(first);q.push(2215494);
        (function next(){
            if(!q.length){console.error('[SMGTV] [Token] 所有 donor 均无地址');cb(null);return}
            var did=q.shift();
            if(tried[did]){next();return}
            tried[did]=true;
            console.log('[SMGTV] [Token] 获取 donor 节目:',did);
            apiGet('/content/pc/tv/program/detail',{channel_program_id:did}).then(function(d){
                var r=(d&&d.result)||{},enc=r.channel_info&&r.channel_info.shift_address;
                if(!enc&&r.channel_info&&r.channel_info.live_address)enc=r.channel_info.live_address;
                if(!enc){console.warn('[SMGTV] [Token] donor 无地址，换下一个 (id='+did+')');next();return}
                var pl=rsaDec(enc);if(!pl)throw new Error('解密失败');
                var t=tokFromUrl(pl);if(!t)throw new Error('URL 解析失败');
                _tok=t;console.log('[SMGTV] [Token] 就绪, donor='+did+', stream='+t.stream);
                cb(t)}).catch(function(e){console.warn('[SMGTV] [Token] donor 出错，换下一个:',e&&e.message);next()})})()}

    // ===== 3. 构建偏移URL的函数（token 来自自举，不再依赖直播播放器） =====
    function makeShift(ts){
        if(!tokValid(_tok)){console.error('[SMGTV] token 未就绪，请稍后重试');return null}
        return 'https://volc-stream.kksmg.com/live/'+_tok.stream
            +'/index.m3u8?token='+_tok.token
            +'&volcSecret='+_tok.volcSecret
            +'&volcTime='+_tok.volcTime
            +'&startTime='+ts;
    }
    window.makeShift=makeShift;
    // 预取 token（页面加载后即开始，~12h 有效）
    ensureTok(function(t){if(t)console.log('[SMGTV] ✅ token 已就绪，可点击节目播放')});

    // ===== 4. 拦截 initPlayer：直播走直播边缘，回放走节目起点（v0.18: 动态 startTime + 真正切源寻道） =====
    var origInit=v.initPlayer;
    v.initPlayer=function(){
        var p=v.programObj;
        if(p&&p.start_time){
            var self=this,args=arguments;
            var want=(p.play===0)?p.start_time:Math.floor(Date.now()/1000)-30;
            ensureTok(function(t){
                if(!t){console.error('[SMGTV] 无 token，回退原 initPlayer');return origInit.apply(self,args)}
                var url=makeShift(want);
                if(!url){console.error('[SMGTV] makeShift 失败');return}
                try{
                var pStart=(p.play===0)?p.start_time:want;
                var pEnd=(p.play===0)?(p.end_time||(pStart+7200)):(want+3600);
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
            });
            return;
        }
        return origInit.apply(this,arguments);
    };

    console.log('[SMGTV] ✅ 已就绪！token 获取中，稍后点击节目即可播放');
    console.log('[SMGTV] 👉 点击左侧节目列表中的历史节目即可回放（v0.18 支持进度条拖动）');
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

> ⚠️ v0.18 起服务端已清空五星体育 `live_address`，原"恢复流地址 + 调原 initPlayer"已失效。
> 仅直播请直接用模式 A（打开页面即自动播当前直播边缘），本模式保留作其他频道备用。

如果只需要绕过版权限制看直播，不需要回放，用这段更短的代码：

```js
// SMGTV 仅直播 — Console 版 (v0.18)
(function(){
    var v=document.querySelector('.huikan').__vue__;
    if(!v){console.error('[SMGTV] 未找到Vue组件');return}
    function f(o){if(!o)return;o.is_shield=0;o.is_review=1;o.can_review=1}
    f(v.programObj);f(v.programDetail);f(v.playingProgramObj);
    if(v.currChannelDetail){v.currChannelDetail.copyright_image='';v.currChannelDetail.live_shift=0}
    if(v.currChannel){v.currChannel.copyright_image='';v.currChannel.live_shift=0}
    v.isCopyright=false;
    var m=document.querySelector('.image-mask');if(m)m.style.display='none';
    v.$forceUpdate();
    try{v.initPlayer();}catch(e){}
})();
```

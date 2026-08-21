// ==UserScript==
// @name             收看SMGTV电视节目
// @namespace        http://tampermonkey.net/
// @version          0.13
// @description      打开网页即可收看SMGTV，并解除试看倒计时与切页暂停等限制（Safari/Stay 兼容 + 多路径 Vue 探测 + 回放功能）
// @author           https://github.com/Nolan180940
// @match            *://*.kankanews.com/*
// @include          *://live.kankanews.com/*
// @icon             https://live.kankanews.com/favicon.ico
// @grant            none
// @run-at           document-body
// @compatible       safari
// @compatible       stay
// ==/UserScript==

(function() {
    "use strict";

    console.log("[SMGTV] ========== v0.13 ==========");
    console.log("[SMGTV] URL:", location.href);
    console.log("[SMGTV] UA:", navigator.userAgent);

    // ===== 1. CSS: hide copyright mask =====
    var style = document.createElement("style");
    style.textContent = ".image-mask{display:none!important}.video-tip{display:none!important}";
    (document.head || document.documentElement).appendChild(style);
    console.log("[SMGTV] CSS injected");

    // ===== 2. Patch webpack module 560 (E.a URL decryption bypass) =====
    // Module 560 exports E.a which RSA-decrypts live_address strings.
    // Our plain shift URLs pass through E.a and get corrupted to empty string.
    // Fix: monkey-patch E.a to passthrough plain HTTP URLs.
    var _module560Patched = false;
    function patchModule560() {
        if (_module560Patched) return;
        try {
            // Capture __webpack_require__ via a injected chunk
            window.webpackJsonp.push([[], {
                '__smg_m560_probe': function(module, exports, __webpack_require__) {
                    try {
                        var mod560 = __webpack_require__(560);
                        if (mod560 && typeof mod560.a === 'function') {
                            var origEa = mod560.a;
                            mod560.a = function(t) {
                                // If input is a plain URL (starts with http), return as-is
                                if (typeof t === 'string' && t.indexOf('http') === 0) {
                                    console.log("[SMGTV] [Replay] E.a bypass — plain URL passthrough:", t.substring(0, 80));
                                    return t;
                                }
                                // Otherwise, RSA-decrypt as normal
                                return origEa.apply(this, arguments);
                            };
                            _module560Patched = true;
                            console.log("[SMGTV] Module 560 (E.a) patched successfully");
                        }
                    } catch(e) {
                        console.warn("[SMGTV] Module 560 patch failed:", e.message);
                    }
                }
            }, ['__smg_m560_probe']]);
        } catch(e) {
            console.warn("[SMGTV] webpack chunk push failed:", e.message);
        }
    }
    patchModule560();

    // ===== 3. Intercept API responses =====

    // --- XHR: re-patch Vue after API responses (can't reliably modify XHR response in-flight) ---
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        var urlStr = String(url);
        if (urlStr.indexOf("/content/pc/tv/") !== -1) {
            var xhr = this;
            xhr.addEventListener("readystatechange", function() {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    console.log("[SMGTV] XHR response received for:", urlStr.substring(0, 80));
                    // For program detail responses, re-patch with a slight delay
                    // so shift_address gets injected before initPlayer reads it
                    setTimeout(tryPatch, 30);
                }
            });
        }
        return origOpen.apply(this, arguments);
    };

    // --- fetch: re-patch Vue after API responses ---
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
        var urlStr = typeof input === "string" ? input : (input && input.url) || "";
        if (urlStr.indexOf("/content/pc/tv/") !== -1) {
            return origFetch.apply(this, arguments).then(function(resp) {
                console.log("[SMGTV] fetch response received, re-patching Vue...");
                setTimeout(tryPatch, 50);
                return resp;
            });
        }
        return origFetch.apply(this, arguments);
    };

    console.log("[SMGTV] API interceptors ready");

    // ===== 4. Patch Vue component =====

    // Helper: traverse Vue 2 $children tree to find component by name
    function findComponent(root, name) {
        if (!root) return null;
        if (root.$options && root.$options.name === name) return root;
        for (var i = 0; root.$children && i < root.$children.length; i++) {
            var found = findComponent(root.$children[i], name);
            if (found) return found;
        }
        return null;
    }

    // Helper: find HuikanIndex via multiple paths (Safari/Stay compatibility)
    function findVue() {
        // Path 1: Direct access via .huikan element (Tampermonkey standard)
        var el = document.querySelector(".huikan");
        if (el && el.__vue__ && typeof el.__vue__.initPlayer === "function") {
            console.log("[SMGTV] Vue found via .huikan.__vue__");
            return el.__vue__;
        }

        // Path 2: From #__nuxt root, traverse $children (works in CDP/Puppeteer/Stay)
        var root = document.querySelector("#__nuxt");
        if (root && root.__vue__) {
            var comp = findComponent(root.__vue__, "HuikanIndex");
            if (comp && typeof comp.initPlayer === "function") {
                console.log("[SMGTV] Vue found via #__nuxt traversal");
                return comp;
            }
        }

        // Path 3: Walk all elements looking for __vue__ with initPlayer (brute force)
        var all = document.querySelectorAll("[class*=huikan], [id*=huikan], .live-player, .video-wrap");
        for (var i = 0; i < all.length; i++) {
            var v = all[i].__vue__;
            if (v && typeof v.initPlayer === "function") {
                console.log("[SMGTV] Vue found via element scan");
                return v;
            }
        }

        // Path 4: Check all top-level __vue__ instances on any element
        var any = document.querySelectorAll("*");
        for (var j = 0; j < any.length && j < 500; j++) {
            var vw = any[j].__vue__;
            if (vw && vw.$options && vw.$options.name === "HuikanIndex") {
                console.log("[SMGTV] Vue found via global element scan");
                return vw;
            }
        }

        return null;
    }

    // ===== 4b. Replay: build volc-stream shift URL for past programs =====
    // The CDN supports time-shift via &startTime= parameter on the same /live/ stream.
    // Each manifest returns ~30s; HLS.js auto-polls for continuous playback.
    function buildShiftUrl(playerUrl, startTime) {
        try {
            var url = new URL(playerUrl);
            var token = url.searchParams.get("token");
            var volcSecret = url.searchParams.get("volcSecret");
            var volcTime = url.searchParams.get("volcTime");
            var match = url.pathname.match(/\/live\/([^/]+)\//);
            if (!match || !token) return null;
            var streamName = match[1];
            return "https://volc-stream.kksmg.com/live/" + streamName +
                "/index.m3u8?token=" + token +
                "&volcSecret=" + volcSecret +
                "&volcTime=" + volcTime +
                "&startTime=" + startTime;
        } catch(e) {
            console.warn("[SMGTV] buildShiftUrl error:", e);
            return null;
        }
    }

    // Override initPlayer to directly create xgplayer for past programs.
    // The server never provides shift_address, so we build it from the volc-stream CDN pattern.
    // KEY INSIGHT: initPlayer calls Object(E.a)(y) which is RSA-decrypt (module 560).
    // It works for encrypted live_address but corrupts plain URLs to empty string.
    // Solution: for past programs, bypass initPlayer entirely and create the player directly.
    var _initPlayerPatched = false;
    function patchInitPlayer(vue) {
        if (_initPlayerPatched) return;
        if (!vue || typeof vue.initPlayer !== "function") return;

        var origInitPlayer = vue.initPlayer;
        vue.initPlayer = function() {
            try {
                var pObj = vue.programObj;
                // Past program (play=0) with start_time — create player directly
                if (pObj && pObj.play === 0 && pObj.start_time) {
                    // Get the decrypted live URL from the existing player
                    var liveUrl = (vue.player && vue.player.config && vue.player.config.url) || "";
                    if (liveUrl) {
                        var shiftUrl = buildShiftUrl(liveUrl, pObj.start_time);
                        if (shiftUrl) {
                            // Set flags so isCopyright gate passes
                            pObj.is_shield = 0;
                            pObj.is_review = 1;
                            vue.isCopyright = true;

                            // Destroy existing player
                            vue.destroyPlayer();

                            // Create xgplayer directly with shift URL (bypass E.a)
                            var volume = localStorage.getItem("playerVolume");
                            volume = volume ? Number(volume) : 0.5;

                            vue.player = new vue.$xgplayer({
                                el: vue.$refs.livePlayer,
                                url: shiftUrl,
                                isLive: false,
                                fluid: true,
                                crossOrigin: true,
                                controls: true,
                                volume: volume,
                                playbackRate: [2, 1.5, 1.25, 1, 0.75, 0.5],
                                ignores: ["cssFullscreen"],
                                keyShortcut: true,
                                lang: "zh-cn",
                                closeVideoClick: true,
                                plugins: [vue.$hlsPlayer]
                            });
                            vue.player.muted = vue.isMuted;

                            // Event handlers
                            vue.player.on("canplay", function() {
                                vue.isLoading = false;
                            });
                            vue.player.on("ended", function() {
                                if (vue.programObj.play === 0 && typeof vue.playNextProgram === "function") {
                                    vue.playNextProgram();
                                }
                            });
                            setTimeout(function() { vue.player.play(); }, 200);
                            vue.player.video.addEventListener("click", function() {
                                if (vue.player.paused) vue.player.play();
                                else vue.player.pause();
                            });

                            console.log("[SMGTV] [Replay] Direct player created for:", pObj.name,
                                "startTime:", pObj.start_time, "url:", shiftUrl.substring(0, 80));
                            return;
                        }
                    }
                    // Fallback: no live URL available yet, try origInitPlayer
                    console.warn("[SMGTV] [Replay] No live URL for shift, falling back to orig initPlayer");
                }
            } catch(e) {
                console.error("[SMGTV] [Replay] initPlayer intercept error:", e);
            }
            return origInitPlayer.apply(this, arguments);
        };
        _initPlayerPatched = true;
        console.log("[SMGTV] [Replay] initPlayer patched");
    }

    function tryPatch() {
        var vue = findVue();
        if (!vue) return false;

        console.log("[SMGTV] Vue component found, patching...");

        // Patch initPlayer for replay (only once)
        patchInitPlayer(vue);

        function fixObj(o) {
            if (!o) return;
            o.is_shield = 0;
            o.is_review = 1;
            o.can_review = 1;
        }
        fixObj(vue.programObj);
        fixObj(vue.programDetail);
        fixObj(vue.playingProgramObj);
        if (Array.isArray(vue.programList)) vue.programList.forEach(fixObj);
        if (Array.isArray(vue.currentProgramList)) vue.currentProgramList.forEach(fixObj);

        if (vue.currChannelDetail) {
            vue.currChannelDetail.copyright_image = "";
        }
        if (vue.currChannel) {
            vue.currChannel.copyright_image = "";
        }

        // Restore live_address from channel detail (server removed it from program detail API)
        if (vue.currChannelDetail && vue.currChannelDetail.live_address) {
            if (!vue.programDetail) vue.programDetail = {};
            if (!vue.programDetail.channel_info) vue.programDetail.channel_info = {};
            if (!vue.programDetail.channel_info.live_address) {
                vue.programDetail.channel_info.live_address = vue.currChannelDetail.live_address;
            }
        }

        // Disable isCopyright to prevent auto-init (we control initPlayer ourselves)
        vue.isCopyright = false;

        if (typeof vue.countdown === "number") vue.countdown = 99999999;
        vue.showOpenApp = false;
        vue.showFlag = false;
        if (typeof vue.startCountdown === "function") vue.startCountdown = function() {};
        if (vue.liveTimer) { clearTimeout(vue.liveTimer); vue.liveTimer = null; }

        if (typeof vue.pageVisibilityChange === "function") {
            document.removeEventListener("visibilitychange", vue.pageVisibilityChange);
            vue.pageVisibilityChange = function() {};
            document.addEventListener("visibilitychange", vue.pageVisibilityChange);
        }

        // Init player
        if (!vue.player && vue.programObj && vue.programObj.id) {
            console.log("[SMGTV] Calling initPlayer()...");
            try { vue.initPlayer(); } catch(e) { console.error("[SMGTV] initPlayer error:", e); }
        }

        vue.$forceUpdate();
        vue.__smgPatched = true;
        console.log("[SMGTV] Patch applied!");
        return true;
    }

    // --- Initial patch with enhanced retry (60s for Safari/Stay) ---
    if (tryPatch()) {
        console.log("[SMGTV] Patched immediately");
    } else {
        console.log("[SMGTV] Waiting for component...");
        var observer = new MutationObserver(function() {
            if (tryPatch()) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        var count = 0;
        var timer = setInterval(function() {
            count++;
            if (tryPatch()) {
                clearInterval(timer);
                observer.disconnect();
                console.log("[SMGTV] Patched after " + count + " polls");
            } else if (count >= 120) {
                clearInterval(timer);
                observer.disconnect();
                console.warn("[SMGTV] Timeout after 60s — check Console [SMGTV] logs for diagnostics");
            }
        }, 500);
    }

    // ===== 5. SPA route change: re-patch when user switches channels =====
    var lastHref = location.href;
    setInterval(function() {
        // Re-hide mask
        var mask = document.querySelector(".image-mask");
        if (mask && mask.style.display !== "none") mask.style.display = "none";

        // Detect SPA navigation
        if (location.href !== lastHref) {
            lastHref = location.href;
            console.log("[SMGTV] Route changed, re-patching in 2s...");
            setTimeout(tryPatch, 2000);
        }
    }, 1000);

})();
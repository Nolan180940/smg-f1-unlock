// ==UserScript==
// @name             收看SMGTV电视节目
// @namespace        http://tampermonkey.net/
// @version          0.17
// @description      打开网页即可收看SMGTV，并解除试看倒计时与切页暂停等限制（Safari/Stay 兼容 + 多路径 Vue 探测 + 回放功能 + 进度条拖动）
// @author           https://github.com/Nolan180940
// @match            https://live.kankanews.com/*
// @match            https://m.kankanews.com/*
// @match            http://live.kankanews.com/*
// @match            http://m.kankanews.com/*
// @icon             https://live.kankanews.com/favicon.ico
// @grant            none
// @run-at           document-body
// @compatible       safari
// @compatible       stay
// ==/UserScript==

(function() {
    "use strict";

    console.log("[SMGTV] ========== v0.17 ==========");
    console.log("[SMGTV] URL:", location.href);

    // ===== 0. Mobile handling =====
    // The server detects mobile UA and redirects live.kankanews.com → m.kankanews.com,
    // but corrupts the URL: /huikan?id=10 → /huikan/10 (404).
    // We can't redirect back without causing an infinite loop (server → m → live → server → ...).
    // Solution: use history.replaceState to fix the URL in-place, then continue.
    if (location.hostname === "m.kankanews.com") {
        // Fix /huikan/10 → /huikan?id=10 in-place (no page reload)
        var m = location.pathname.match(/^\/huikan\/(\d+)$/);
        if (m) {
            var fixed = "/huikan?id=" + m[1];
            history.replaceState(null, "", fixed);
            console.log("[SMGTV] Fixed broken mobile URL in-place:", fixed);
        }
    }
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

    // ===== 4c. Replay: dynamic startTime + real source-switch seeking =====
    // ROOT CAUSE: CDN shift manifest returns only 3 segments (~30s) for a fixed startTime.
    // Same startTime → same 3 segments every time. After 30s, HLS.js re-fetches → same data → freeze.
    // FIX: Before each manifest load, rewrite startTime = programStartTime + playback position.
    // This makes each poll fetch segments from the CURRENT playback position, enabling infinite replay.
    // For seek: switch the complete HLS source so old MSE data cannot remain on screen.
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
                    var liveUrl = (vue.player && vue.player.config && vue.player.config.url) || "";
                    if (liveUrl) {
                        var shiftUrl = buildShiftUrl(liveUrl, pObj.start_time);
                        if (shiftUrl) {
                            pObj.is_shield = 0;
                            pObj.is_review = 1;
                            vue.isCopyright = true;
                            vue.destroyPlayer();

                            var volume = localStorage.getItem("playerVolume");
                            volume = volume ? Number(volume) : 0.5;

                            // Track program start time for dynamic startTime calculation
                            var programStartTime = pObj.start_time;
                            var programEndTime = pObj.end_time || (programStartTime + 7200);

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

                            // --- Hook into HLS.js manifest loader for dynamic startTime ---
                            function hookManifestLoader(player) {
                                // Wait for HLS.js plugin to initialize (may need a tick)
                                var attempts = 0;
                                var hookTimer = setInterval(function() {
                                    attempts++;
                                    var hlsPlugin = player.plugins && player.plugins.hls;
                                    var hls = hlsPlugin && hlsPlugin.hls;
                                    if (!hls || !hls._manifestLoader) {
                                        if (attempts > 20) { clearInterval(hookTimer); }
                                        return;
                                    }
                                    clearInterval(hookTimer);

                                    var manifestLoader = hls._manifestLoader;
                                    var origMlLoad = manifestLoader.load.bind(manifestLoader);

                                    // --- Seek + position tracking ---
                                    // HLS.js returns a short, relative media timeline after every
                                    // shift-manifest load. Calling manifestLoader.load() alone only
                                    // downloads the manifest; it does not replace the old MSE buffer.
                                    //
                                    // Use xgplayer.switchURL() for a real source switch. Its HLS
                                    // implementation clears the old buffer, loads the new manifest,
                                    // selects the first segment, and starts the media at relative 0.
                                    // _virtualPos is the position in the full program and is exposed
                                    // to the progress controls through offsetCurrentTime.
                                    var _virtualPos = 0;
                                    var _virtualPosTs = Date.now();
                                    var _isSeeking = false;
                                    var _hasUserSeek = false;
                                    var _seekGeneration = 0;
                                    var _seekDebounceTimer = null;
                                    var _seekSwitchQueue = Promise.resolve();

                                    // The HLS plugin resets offsetCurrentTime to -1 while it
                                    // clears/rebuilds MediaSource. Install an instance-level
                                    // logical-time property so the progress/time controls keep
                                    // showing the program position during and after that reset.
                                    try {
                                        Object.defineProperty(player, "offsetCurrentTime", {
                                            get: function() { return _virtualPos; },
                                            set: function() {},
                                            configurable: true,
                                            enumerable: true
                                        });
                                    } catch (e) {
                                        console.warn("[SMGTV] [Replay] Could not lock offsetCurrentTime:", e);
                                    }

                                    function clampVirtualPos(pos) {
                                        pos = Number(pos);
                                        if (!isFinite(pos)) return 0;
                                        return Math.max(0, Math.min(
                                            programEndTime - programStartTime, pos));
                                    }

                                    function publishVirtualPos() {
                                        // The instance getter above is the source of truth. Keep
                                        // this call for fallback compatibility if defineProperty
                                        // is unavailable in an older browser.
                                        player.offsetCurrentTime = _virtualPos;
                                    }

                                    // Advance the program position independently from the relative
                                    // media currentTime. This survives HLS.js resetting media time
                                    // to 0 after a source switch.
                                    setInterval(function() {
                                        if (!player.paused && !_isSeeking) {
                                            var now = Date.now();
                                            _virtualPos += (now - _virtualPosTs) / 1000;
                                            _virtualPosTs = now;
                                            _virtualPos = clampVirtualPos(_virtualPos);
                                            publishVirtualPos();
                                        } else {
                                            _virtualPosTs = Date.now();
                                        }
                                    }, 500);

                                    // Before the first user seek, media time and program time are
                                    // identical, so it is safe to synchronize the virtual position.
                                    setInterval(function() {
                                        if (!player.paused && !_isSeeking && !_hasUserSeek) {
                                            _virtualPos = clampVirtualPos(player.currentTime);
                                            _virtualPosTs = Date.now();
                                            publishVirtualPos();
                                        }
                                    }, 1000);
                                    publishVirtualPos();

                                    // Override player.seek() — the progress plugin calls this for a
                                    // user click/drag. Do NOT call the original seek(time): the new
                                    // manifest's media timeline starts at 0, not at `time` (2400s).
                                    player.seek = function(time) {
                                        var target = clampVirtualPos(time);
                                        var seekTs = Math.floor(programStartTime + target);
                                        ++_seekGeneration;
                                        var wasPaused = player.paused;
                                        _hasUserSeek = true;
                                        _virtualPos = target;
                                        _virtualPosTs = Date.now();
                                        _isSeeking = true;
                                        publishVirtualPos();

                                        if (_seekDebounceTimer) {
                                            clearTimeout(_seekDebounceTimer);
                                        }

                                        console.log("[SMGTV] [Replay] Seek target → pos=" +
                                            target.toFixed(1) + "s", "seekTime=" + seekTs);

                                        // The progress plugin calls seek repeatedly while dragging.
                                        // Switch only once after the drag settles; otherwise several
                                        // asynchronous HLS resets race and the last old request wins.
                                        _seekDebounceTimer = setTimeout(function() {
                                            var finalTarget = _virtualPos;
                                            var finalTs = Math.floor(programStartTime + finalTarget);
                                            var finalGeneration = _seekGeneration;
                                            var finalWasPaused = player.paused;

                                            // A drag can produce several seek() calls. Queue complete
                                            // source switches so an older async switch cannot race
                                            // with and overwrite the latest target.
                                            _seekSwitchQueue = _seekSwitchQueue.catch(function() {}).then(function() {
                                                if (finalGeneration !== _seekGeneration) return;

                                                var seekUrl = buildShiftUrl(liveUrl, finalTs);
                                                if (!seekUrl || typeof player.switchURL !== "function") {
                                                    console.error("[SMGTV] [Replay] switchURL unavailable; seek cancelled");
                                                    _isSeeking = false;
                                                    return;
                                                }

                                                console.log("[SMGTV] [Replay] Switching source:",
                                                    "vPos=" + finalTarget.toFixed(1) + "s",
                                                    "seekTime=" + finalTs);

                                                // switchURL performs the full HLS reset. currentTime: 0
                                                // is relative to the new manifest, not the program.
                                                var switchPromise;
                                                try {
                                                    switchPromise = player.switchURL(seekUrl, {
                                                        seamless: false,
                                                        currentTime: 0
                                                    });
                                                } catch (error) {
                                                    _isSeeking = false;
                                                    console.error("[SMGTV] [Replay] Seek source switch failed:", error);
                                                    return;
                                                }

                                                return Promise.resolve(switchPromise).then(function() {
                                                    if (finalGeneration !== _seekGeneration) return;
                                                    _isSeeking = false;
                                                    _virtualPosTs = Date.now();
                                                    publishVirtualPos();
                                                    if (finalWasPaused) player.pause();
                                                    else player.play();
                                                    console.log("[SMGTV] [Replay] Seek source switched:",
                                                        "vPos=" + _virtualPos.toFixed(1) + "s");
                                                }).catch(function(error) {
                                                    if (finalGeneration !== _seekGeneration) return;
                                                    _isSeeking = false;
                                                    console.error("[SMGTV] [Replay] Seek source switch failed:", error);
                                                });
                                            });
                                        }, 150);

                                        return undefined;
                                    };

                                    // Override manifestLoader.load — ALWAYS use _virtualPos
                                    manifestLoader.load = function(url) {
                                        if (typeof url === "string" && url.indexOf("startTime=") !== -1) {
                                            var newStartTime = Math.floor(programStartTime + _virtualPos);
                                            var newUrl = url.replace(/startTime=\d+/, "startTime=" + newStartTime);
                                            if (newUrl !== url) {
                                                console.log("[SMGTV] [Replay] startTime→",
                                                    "vPos=" + _virtualPos.toFixed(1) + "s",
                                                    "→ ts=" + newStartTime);
                                            }
                                            return origMlLoad(newUrl);
                                        }
                                        return origMlLoad.apply(this, arguments);
                                    };

                                    console.log("[SMGTV] [Replay] Manifest loader hooked (virtual pos tracker)");
                                    var dur = programEndTime - programStartTime;
                                    // Override video.duration with a getter so xgplayer always
                                    // sees the real program duration (even if codec fails to init)
                                    Object.defineProperty(player.video, "duration", {
                                        get: function() { return dur; },
                                        configurable: true
                                    });
                                    player._duration = dur;

                                    console.log("[SMGTV] [Replay] Program duration set:",
                                        dur + "s (" + (dur / 60).toFixed(1) + " min)");
                                }, 200);
                            }

                            hookManifestLoader(vue.player);

                            // Event handlers
                            vue.player.on("canplay", function() {
                                vue.isLoading = false;
                                // Force xgplayer to pick up our overridden duration
                                vue.player.video.dispatchEvent(new Event("loadedmetadata"));
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
                                "startTime:", programStartTime,
                                "duration:", (programEndTime - programStartTime) + "s",
                                "url:", shiftUrl.substring(0, 80));
                            return;
                        }
                    }
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
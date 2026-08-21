// ==UserScript==
// @name             收看SMGTV电视节目
// @namespace        http://tampermonkey.net/
// @version          0.10
// @description      打开网页即可收看SMGTV，并解除试看倒计时与切页暂停等限制（2026-08-21 适配 isCopyright 开关 + live_address 服务端清空）
// @author           https://github.com/Nolan180940
// @match            *://*.kankanews.com/*
// @include          *://live.kankanews.com/*
// @icon             https://live.kankanews.com/favicon.ico
// @grant            none
// @run-at           document-end
// ==/UserScript==

(function() {
    "use strict";

    console.log("[SMGTV] ========== v0.10 ==========");
    console.log("[SMGTV] URL:", location.href);

    // ===== 1. CSS: hide copyright mask =====
    var style = document.createElement("style");
    style.textContent = ".image-mask{display:none!important}.video-tip{display:none!important}";
    (document.head || document.documentElement).appendChild(style);
    console.log("[SMGTV] CSS injected");

    // ===== 2. Intercept API responses =====

    // --- XHR: re-patch Vue after API responses (can't reliably modify XHR response in-flight) ---
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        var urlStr = String(url);
        if (urlStr.indexOf("/content/pc/tv/") !== -1) {
            var xhr = this;
            xhr.addEventListener("readystatechange", function() {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    console.log("[SMGTV] XHR response received, re-patching Vue...");
                    setTimeout(tryPatch, 50);
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

    // ===== 3. Patch Vue component =====
    function tryPatch() {
        var el = document.querySelector(".huikan");
        if (!el) return false;
        var vue = el.__vue__;
        if (!vue || typeof vue.initPlayer !== "function") return false;

        console.log("[SMGTV] Vue component found, patching...");

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

        if (vue.currChannelDetail) {
            vue.currChannelDetail.copyright_image = "";
            vue.currChannelDetail.live_shift = 0;
        }
        if (vue.currChannel) {
            vue.currChannel.copyright_image = "";
            vue.currChannel.live_shift = 0;
        }

        // 2026-08 NEW: restore live_address from channel detail (server removed it from program detail API)
        if (vue.currChannelDetail && vue.currChannelDetail.live_address) {
            if (!vue.programDetail) vue.programDetail = {};
            if (!vue.programDetail.channel_info) vue.programDetail.channel_info = {};
            if (!vue.programDetail.channel_info.live_address) {
                vue.programDetail.channel_info.live_address = vue.currChannelDetail.live_address;
            }
        }

        // 2026-08 NEW: bypass isCopyright gate (initPlayer destroys player when true)
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
            } else if (count >= 60) {
                clearInterval(timer);
                console.warn("[SMGTV] Timeout after 30s");
            }
        }, 500);
    }

    // ===== 4. Keep image-mask hidden =====
    setInterval(function() {
        var mask = document.querySelector(".image-mask");
        if (mask && mask.style.display !== "none") mask.style.display = "none";
    }, 200);

})();
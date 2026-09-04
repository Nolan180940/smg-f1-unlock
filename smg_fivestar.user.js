// ==UserScript==
// @name             收看SMGTV电视节目
// @namespace        http://tampermonkey.net/
// @version          0.18
// @description      打开网页即可收看SMGTV，并解除试看倒计时与切页暂停等限制（Safari/Stay 兼容 + 多路径 Vue 探测 + 回放功能 + 进度条拖动 + token自举）
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

    console.log("[SMGTV] ========== v0.18 ==========");
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

    // ===== 4b. Token bootstrap (v0.18) =====
    // 2026-09: server emptied live_address for ch10, so there is no live player
    // URL to steal a token from. But the CDN does NOT verify whether a program
    // is copyrighted — any valid token works with &startTime= for any timestamp.
    // So we fetch program/detail for a program that still carries a
    // shift_address (daily sports news, is_review=1), RSA-decrypt it with the
    // page's own public key (same algorithm as webpack module 560/E.a), and use
    // the resulting token for all shift URLs. Token is cached (~12h validity).
    var SMG_PUBKEY = "-----BEGIN PUBLIC KEY-----\n" +
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDP5hzPUW5RFeE2xBT1ERB3hHZI\n" +
        "Votn/qatWhgc1eZof09qKjElFN6Nma461ZAwGpX4aezKP8Adh4WJj4u2O54xCXDt\n" +
        "wzKRqZO2oNZkuNmF2Va8kLgiEQAAcxYc8JgTN+uQQNpsep4n/o1sArTJooZIF17E\n" +
        "tSqSgXDcJ7yDj5rc7wIDAQAB\n" +
        "-----END PUBLIC KEY-----";
    var SMG_API_SECRET = "28c8edde3d61a0411511d3b1866f0636";
    var SMG_API_VERSION = "2.42.23";
    var SMG_DONOR_IDS = [2215494];
    var _smgTokenCache = null;

    function smgMd5(str) {
        function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
        function add(x, y) {
            var l = (x & 0xffff) + (y & 0xffff);
            var m = (x >> 16) + (y >> 16) + (l >> 16);
            return (m << 16) | (l & 0xffff);
        }
        function cmn(q, a, b, x, s, t) {
            a = add(add(a, q), add(x, t));
            return add(rl(a, s), b);
        }
        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
        function binl(s) {
            var b = [];
            var m = (1 << 8) - 1;
            for (var i = 0; i < s.length * 8; i += 8) b[i >> 5] |= (s.charCodeAt(i / 8) & m) << (i % 32);
            return b;
        }
        function binl2hex(b) {
            var h = "0123456789abcdef";
            var s = "";
            for (var i = 0; i < b.length * 4; i++) {
                s += h.charAt((b[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) + h.charAt((b[i >> 2] >> ((i % 4) * 8)) & 0xf);
            }
            return s;
        }
        str = unescape(encodeURIComponent(str));
        var x = binl(str);
        x[str.length >> 2] |= 0x80 << ((str.length % 4) << 3);
        x[(((str.length + 8) >> 6) << 4) + 14] = str.length * 8;
        var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (var i = 0; i < x.length; i += 16) {
            var oa = a, ob = b, oc = c, od = d;
            a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i+1], 12, -389564586);
            c = ff(c, d, a, b, x[i+2], 17, 606105819); b = ff(b, c, d, a, x[i+3], 22, -1044525330);
            a = ff(a, b, c, d, x[i+4], 7, -176418897); d = ff(d, a, b, c, x[i+5], 12, 1200080426);
            c = ff(c, d, a, b, x[i+6], 17, -1473231341); b = ff(b, c, d, a, x[i+7], 22, -45705983);
            a = ff(a, b, c, d, x[i+8], 7, 1770035416); d = ff(d, a, b, c, x[i+9], 12, -1958414417);
            c = ff(c, d, a, b, x[i+10], 17, -42063); b = ff(b, c, d, a, x[i+11], 22, -1990404162);
            a = ff(a, b, c, d, x[i+12], 7, 1804603682); d = ff(d, a, b, c, x[i+13], 12, -40341101);
            c = ff(c, d, a, b, x[i+14], 17, -1502002290); b = ff(b, c, d, a, x[i+15], 22, 1236535329);
            a = gg(a, b, c, d, x[i+1], 5, -165796510); d = gg(d, a, b, c, x[i+6], 9, -1069501632);
            c = gg(c, d, a, b, x[i+11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
            a = gg(a, b, c, d, x[i+5], 5, -701558691); d = gg(d, a, b, c, x[i+10], 9, 38016083);
            c = gg(c, d, a, b, x[i+15], 14, -660478335); b = gg(b, c, d, a, x[i+4], 20, -405537848);
            a = gg(a, b, c, d, x[i+9], 5, 568446438); d = gg(d, a, b, c, x[i+14], 9, -1019803690);
            c = gg(c, d, a, b, x[i+3], 14, -187363961); b = gg(b, c, d, a, x[i+8], 20, 1163531501);
            a = gg(a, b, c, d, x[i+13], 5, -1444681467); d = gg(d, a, b, c, x[i+2], 9, -51403784);
            c = gg(c, d, a, b, x[i+7], 14, 1735328473); b = gg(b, c, d, a, x[i+12], 20, -1926607734);
            a = hh(a, b, c, d, x[i+5], 4, -378558); d = hh(d, a, b, c, x[i+8], 11, -2022574463);
            c = hh(c, d, a, b, x[i+11], 16, 1839030562); b = hh(b, c, d, a, x[i+14], 23, -35309556);
            a = hh(a, b, c, d, x[i+1], 4, -1530992060); d = hh(d, a, b, c, x[i+4], 11, 1272893353);
            c = hh(c, d, a, b, x[i+7], 16, -155497632); b = hh(b, c, d, a, x[i+10], 23, -1094730640);
            a = hh(a, b, c, d, x[i+13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222);
            c = hh(c, d, a, b, x[i+3], 16, -722521979); b = hh(b, c, d, a, x[i+6], 23, 76029189);
            a = hh(a, b, c, d, x[i+9], 4, -640364487); d = hh(d, a, b, c, x[i+12], 11, -421815835);
            c = hh(c, d, a, b, x[i+15], 16, 530742520); b = hh(b, c, d, a, x[i+2], 23, -995338651);
            a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i+7], 10, 1126891415);
            c = ii(c, d, a, b, x[i+14], 15, -1416354905); b = ii(b, c, d, a, x[i+5], 21, -57434055);
            a = ii(a, b, c, d, x[i+12], 6, 1700485571); d = ii(d, a, b, c, x[i+3], 10, -1894986606);
            c = ii(c, d, a, b, x[i+10], 15, -1051523); b = ii(b, c, d, a, x[i+1], 21, -2054922799);
            a = ii(a, b, c, d, x[i+8], 6, 1873313359); d = ii(d, a, b, c, x[i+15], 10, -30611744);
            c = ii(c, d, a, b, x[i+6], 15, -1560198380); b = ii(b, c, d, a, x[i+13], 21, 1309151649);
            a = ii(a, b, c, d, x[i+4], 6, -145523070); d = ii(d, a, b, c, x[i+11], 10, -1120210379);
            c = ii(c, d, a, b, x[i+2], 15, 718787259); b = ii(b, c, d, a, x[i+9], 21, -343485551);
            a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
        }
        return binl2hex([a, b, c, d]);
    }

    function smgRsaDecrypt(enc) {
        try {
            if (!enc || typeof enc !== "string") return "";
            if (typeof JSEncrypt === "undefined") return "";
            var hex = window.atob(enc).split("").map(function(ch) {
                return ("0" + ch.charCodeAt(0).toString(16)).slice(-2);
            }).join("").toUpperCase();
            if (!hex) return "";
            var crypt = new JSEncrypt();
            crypt.setPublicKey(SMG_PUBKEY);
            var out = "";
            for (var pos = 0; pos < hex.length;) {
                var chunk = hex.slice(pos, pos + 256);
                pos += 256;
                var bytes = (chunk.replace(/\r|\n/g, "").match(/[\da-fA-F]{2}/g) || [])
                    .map(function(h) { return parseInt(h, 16); });
                var b64 = window.btoa(String.fromCharCode.apply(String, bytes));
                if (!b64) continue;
                var m = crypt.decrypt(b64);
                if (m) out += m;
            }
            return out;
        } catch (e) {
            console.warn("[SMGTV] smgRsaDecrypt failed:", e && e.message);
            return "";
        }
    }

    function smgSignParams(params) {
        var n = {
            platform: "pc",
            version: SMG_API_VERSION,
            nonce: Math.random().toString(36).slice(-8),
            timestamp: Math.floor(Date.now() / 1000),
            "Api-Version": "v1"
        };
        var merged = {};
        var k;
        for (k in params) merged[k] = params[k];
        for (k in n) merged[k] = n[k];
        var keys = Object.keys(merged).sort();
        var s = "";
        for (var i = 0; i < keys.length; i++) {
            if (merged[keys[i]] != null) s += keys[i] + "=" + merged[keys[i]] + "&";
        }
        merged.sign = smgMd5(smgMd5(s + SMG_API_SECRET));
        return merged;
    }

    // NOTE: sign fields MUST go in headers, NOT in the query string. The server
    // verifies the signature but ALSO gates address fields on request shape:
    // the same signature sent as query params returns code 4001 with empty
    // addresses, while header form returns code 1000 with addresses.
    function smgApiGet(path, params) {
        var signed = smgSignParams(params || {});
        var q = Object.keys(params || {}).map(function(k) {
            return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
        }).join("&");
        var headers = { "Accept": "application/json, text/plain, */*" };
        var hk;
        for (hk in signed) headers[hk] = signed[hk];
        headers["M-Uuid"] = localStorage.getItem("uuid") || "";
        return fetch("https://kapi.kankanews.com" + path + (q ? "?" + q : ""), {
            headers: headers
        }).then(function(resp) { return resp.json(); });
    }

    function smgTokenFromUrl(url) {
        try {
            var u = new URL(url);
            var token = u.searchParams.get("token");
            if (!token) return null;
            var match = u.pathname.match(/\/live\/([^/]+)\//);
            if (!match) return null;
            var payload = JSON.parse(atob(token.split(".")[1]));
            return {
                token: token,
                volcSecret: u.searchParams.get("volcSecret"),
                volcTime: u.searchParams.get("volcTime"),
                stream: match[1],
                exp: payload.exp || 0
            };
        } catch (e) {
            return null;
        }
    }

    function smgTokenValid(t) {
        return !!t && !!t.token && (t.exp * 1000 - Date.now() > 5 * 60 * 1000);
    }

    function smgFindDonorId(vue) {
        try {
            var lists = [vue.programList, vue.currentProgramList, vue.playingProgramList];
            for (var i = 0; i < lists.length; i++) {
                var arr = lists[i];
                if (!Array.isArray(arr)) continue;
                for (var j = 0; j < arr.length; j++) {
                    if (arr[j] && arr[j].is_review === 1 && arr[j].id) return arr[j].id;
                }
            }
        } catch (e) {}
        return SMG_DONOR_IDS[0];
    }

    function smgEnsureToken(vue, cb) {
        if (smgTokenValid(_smgTokenCache)) {
            cb(_smgTokenCache);
            return;
        }
        // Candidate donor IDs: today's reviewable program first, then known-good
        // history. Only programs with is_review=1 carry a shift_address; all
        // others return empty addresses and must be skipped, not failed on.
        var tried = {};
        var queue = [];
        var first = smgFindDonorId(vue);
        if (first) queue.push(first);
        for (var i = 0; i < SMG_DONOR_IDS.length; i++) {
            if (SMG_DONOR_IDS[i] !== first) queue.push(SMG_DONOR_IDS[i]);
        }
        console.log("[SMGTV] [Token] donor queue:", queue.join(","));
        function tryNext() {
            if (!queue.length) {
                console.error("[SMGTV] [Token] bootstrap failed: all donors empty");
                cb(null);
                return;
            }
            var donorId = queue.shift();
            if (tried[donorId]) {
                tryNext();
                return;
            }
            tried[donorId] = true;
            console.log("[SMGTV] [Token] fetching donor program/detail:", donorId);
            smgApiGet("/content/pc/tv/program/detail", { channel_program_id: donorId }).then(function(data) {
                var res = (data && data.result) || {};
                var enc = res.channel_info && res.channel_info.shift_address;
                if (!enc && res.channel_info && res.channel_info.live_address) {
                    enc = res.channel_info.live_address;
                }
                if (!enc) {
                    console.warn("[SMGTV] [Token] donor empty, trying next (id=" + donorId + ")");
                    tryNext();
                    return;
                }
                var plain = smgRsaDecrypt(enc);
                if (!plain) throw new Error("donor decrypt failed (id=" + donorId + ")");
                var t = smgTokenFromUrl(plain);
                if (!t) throw new Error("donor URL parse failed (id=" + donorId + ")");
                _smgTokenCache = t;
                if (SMG_DONOR_IDS[0] !== donorId) SMG_DONOR_IDS.unshift(donorId);
                console.log("[SMGTV] [Token] ready via donor " + donorId + ", stream=" + t.stream,
                    "exp=" + new Date(t.exp * 1000).toLocaleString());
                cb(t);
            }).catch(function(e) {
                console.warn("[SMGTV] [Token] donor error, trying next:",
                    e && e.message);
                tryNext();
            });
        }
        tryNext();
    }

    function smgBuildShiftUrl(t, startTime) {
        if (!t) return null;
        return "https://volc-stream.kksmg.com/live/" + t.stream +
            "/index.m3u8?token=" + t.token +
            "&volcSecret=" + t.volcSecret +
            "&volcTime=" + t.volcTime +
            "&startTime=" + startTime;
    }

    // ===== 4c. Replay: build volc-stream shift URL for past programs =====
    // The CDN supports time-shift via &startTime= parameter on the same /live/ stream.
    // Each manifest returns ~30s; HLS.js auto-polls for continuous playback.
    // v0.18: token comes from the async donor bootstrap (smgEnsureToken), NOT from
    // the live player URL (server emptied ch10 live_address, so no live URL exists).
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
                // Any program with start_time — create player directly via donor token.
                // v0.18: server emptied ch10 live_address, so the old "steal token from
                // live player URL" path is dead. smgEnsureToken fetches a donor
                // shift_address (daily sports news) and decrypts a fresh token.
                // Works for live-edge (play=1, startTime=now-30s) and replay alike.
                if (pObj && pObj.start_time) {
                    var self = this;
                    var args = arguments;
                    var wantStart = (pObj.play === 0) ? pObj.start_time : Math.floor(Date.now() / 1000) - 30;
                    smgEnsureToken(vue, function(t) {
                        if (!t) {
                            console.error("[SMGTV] [Replay] no token, falling back to orig initPlayer");
                            return origInitPlayer.apply(self, args);
                        }
                        var shiftUrl = smgBuildShiftUrl(t, wantStart);
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

                                                var seekUrl = smgBuildShiftUrl(_smgTokenCache, finalTs);
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
                        console.warn("[SMGTV] [Replay] shift URL build failed, falling back to orig initPlayer");
                        return origInitPlayer.apply(self, args);
                    });
                    // Token fetch is async; tell the caller we handled it.
                    return;
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
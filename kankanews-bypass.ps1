param([int]$IntervalMin = 35)

$Browser = "msedge.exe"
$Profile = "$env:TEMP\kks-profile"
$Port = 19222
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ScriptDir) { $ScriptDir = $PWD.Path }
$PlayerPath = Join-Path $ScriptDir "player.html"

Write-Host "===== Kankanews Auto Stream Fetcher v2 ====="
Write-Host ""

# Compile CDP helper
Add-Type -TypeDefinition @"
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
public class CDP {
    public static string Send(string wsUrl, string json) {
        var ws = new ClientWebSocket();
        ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None).GetAwaiter().GetResult();
        var bytes = Encoding.UTF8.GetBytes(json);
        var seg = new ArraySegment<byte>(bytes);
        ws.SendAsync(seg, WebSocketMessageType.Text, true, CancellationToken.None).GetAwaiter().GetResult();
        var buf = new byte[131072];
        var r = ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None).GetAwaiter().GetResult();
        ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).GetAwaiter().GetResult();
        return Encoding.UTF8.GetString(buf, 0, r.Count);
    }
}
"@ -ErrorAction Stop

# Extracted bypass JS (used in both initial and refresh)
$BypassJS = @'
(function() {
    var vue = document.querySelector("#__nuxt").__vue__;
    if (!vue) return "NO_VUE";
    function find(c, n) {
        if (c.$options && c.$options.name === n) return c;
        for (var i = 0; c.$children && i < c.$children.length; i++) {
            var f = find(c.$children[i], n); if (f) return f;
        }
        return null;
    }
    var h = find(vue, "HuikanIndex");
    if (!h || !h.programObj) return "NO_COMP";
    function fix(o) { if (!o) return; o.is_shield = 0; o.is_review = 1; o.can_review = 1; }
    fix(h.programObj);
    fix(h.programDetail);
    fix(h.playingProgramObj);
    if (h.currChannelDetail) h.currChannelDetail.copyright_image = "";
    if (h.currChannelDetail && h.currChannelDetail.live_address && h.programDetail) {
        h.programDetail.channel_info = h.programDetail.channel_info || {};
        if (!h.programDetail.channel_info.live_address) {
            h.programDetail.channel_info.live_address = h.currChannelDetail.live_address;
        }
    }
    h.isCopyright = false;
    var mask = document.querySelector(".image-mask");
    if (mask) mask.style.display = "none";
    h.$forceUpdate();
    setTimeout(function() { try { h.initPlayer(); } catch(e) {} }, 100);
    return "OK";
})()
'@

# Cleanup old debugging instance
$old = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%remote-debugging-port=$Port%'" -ErrorAction SilentlyContinue
if ($old) { $old | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 2 }
Remove-Item $Profile -Recurse -Force 2>$null
New-Item $Profile -ItemType Directory -Force >$null

# Launch browser with remote debugging
Write-Host "[1] Launching Edge with remote debugging..."
$p = Start-Process -FilePath $Browser -ArgumentList "--remote-debugging-port=$Port", "--user-data-dir=$Profile", "--no-first-run", "--new-window", "https://live.kankanews.com/huikan?id=10" -PassThru
Start-Sleep 5

# Connect to CDP
try {
    $tabs = Invoke-RestMethod "http://localhost:$Port/json" -ErrorAction Stop
} catch {
    Write-Host "  ERROR: Cannot connect to CDP port $Port. Is Edge/Chrome running with --remote-debugging-port?" -ForegroundColor Red
    pause; exit 1
}
$tab = $tabs | Where-Object { $_.url -like "*huikan*" } | Select-Object -First 1
if (-not $tab) { $tab = $tabs | Where-Object { $_.url -like "*kankanews*" -or $_.title -like "*新闻*" } | Select-Object -First 1 }
if (-not $tab) { $tab = $tabs | Select-Object -First 1 }
if (-not $tab) {
    Write-Host "  ERROR: No browser tabs found" -ForegroundColor Red
    pause; exit 1
}
$wsUrl = $tab.webSocketDebuggerUrl
Write-Host "  Connected to: $($tab.title)"

# Get browser-level CDP endpoint (needed for Target.createTarget / closeTarget)
$ver = Invoke-RestMethod "http://localhost:$Port/json/version" -ErrorAction Stop
$browserWsUrl = $ver.webSocketDebuggerUrl

# Helper: evaluate JS via CDP
function EvalJS($id, $js) {
    $e = $js -replace '\\', '\\\\' -replace '"', '\"' -replace "`r`n", '\n' -replace "`r", '\n' -replace "`t", '\t'
    $json = "{`"id`":$id,`"method`":`"Runtime.evaluate`",`"params`":{`"expression`":`"$e`",`"awaitPromise`":true}}"
    try {
        return [CDP]::Send($wsUrl, $json) | ConvertFrom-Json
    } catch {
        Write-Host "  CDP error: $($_.Exception.Message)" -ForegroundColor Yellow
        return @{ result = @{ result = @{ value = "CDP_ERROR" } } }
    }
}

# Helper: wait for m3u8 URL to appear
function WaitForM3u8() {
    for ($t = 0; $t -lt 30; $t++) {
        Start-Sleep 1
        $r = EvalJS 10 @'
(function() {
    var entries = performance.getEntriesByType("resource");
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].name.indexOf(".m3u8") > -1 && entries[i].name.indexOf("manifest") < 0) {
            return entries[i].name;
        }
    }
    return "";
})()
'@
        if ($r.result.result.value) { return $r.result.result.value }
    }
    return ''
}

# Bypass copyright shield
Write-Host "[2] Bypassing copyright shield..."
Start-Sleep 2
$r = EvalJS 1 $BypassJS
$status = $r.result.result.value
Write-Host "  $([string]$status)"

if ($status -ne "OK") {
    Write-Host "  WARNING: Bypass returned '$status', retrying in 3s..." -ForegroundColor Yellow
    Start-Sleep 3
    $r = EvalJS 2 $BypassJS
    $status = $r.result.result.value
    Write-Host "  Retry result: $([string]$status)"
}

# Get stream URL
Write-Host "[3] Waiting for stream URL..."
Start-Sleep 6
$m3u8 = WaitForM3u8

if ($m3u8) {
    Write-Host "  Stream URL found!"
    $enc = [System.Uri]::EscapeDataString($m3u8)

    Write-Host "[4] Opening player (same browser instance)..."

    # Build player URL
    $playerFileUrl = "file:///$($PlayerPath.Replace('\','/'))#$enc"

    # Create player tab via CDP (same browser instance, controllable)
    try {
        $playerResult = [CDP]::Send($browserWsUrl, "{`"id`":100,`"method`":`"Target.createTarget`",`"params`":{`"url`":`"$playerFileUrl`"}}") | ConvertFrom-Json
        $playerTargetId = $playerResult.result.targetId
        Write-Host "  Player opened (target: $playerTargetId). Close this window when done."
    } catch {
        Write-Host "  ERROR: Failed to open player tab: $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host ""

    # Auto-refresh loop
    while ($true) {
        Start-Sleep ($IntervalMin * 60)
        Write-Host "[refresh] Getting new stream URL..."

        # Re-bypass shield and init new HLS stream
        $r = EvalJS 1 $BypassJS
        Start-Sleep 5
        $newUrl = WaitForM3u8
        if ($newUrl -and $newUrl -ne $m3u8) {
            $m3u8 = $newUrl
            $enc = [System.Uri]::EscapeDataString($m3u8)
            $newPlayerUrl = "file:///$($PlayerPath.Replace('\','/'))#$enc"

            # Close old player tab
            try {
                [CDP]::Send($browserWsUrl, "{`"id`":200,`"method`":`"Target.closeTarget`",`"params`":{`"targetId`":`"$playerTargetId`"}}") >$null
                Write-Host "  Closed old player tab"
            } catch {
                Write-Host "  Warning: Could not close old tab" -ForegroundColor Yellow
            }

            # Open new player tab with fresh token
            Start-Sleep 1
            try {
                $playerResult = [CDP]::Send($browserWsUrl, "{`"id`":201,`"method`":`"Target.createTarget`",`"params`":{`"url`":`"$newPlayerUrl`"}}") | ConvertFrom-Json
                $playerTargetId = $playerResult.result.targetId
                Write-Host "  Stream refreshed (new target: $playerTargetId)"
            } catch {
                Write-Host "  ERROR: Failed to open new player tab" -ForegroundColor Red
            }
        } else {
            Write-Host "  No new URL or same URL, skipping refresh"
        }
    }
} else {
    Write-Host "  Failed to get stream URL!" -ForegroundColor Red
    pause; exit 1
}

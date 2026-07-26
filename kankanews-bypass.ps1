param([int]$IntervalMin = 35)

$Browser = "msedge.exe"
$Profile = "$env:TEMP\kks-profile"
$Port = 19222
$PlayerPath = Join-Path $PSScriptRoot "player.html"

Write-Host "===== Kankanews Auto Stream Fetcher ====="
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
$tabs = Invoke-RestMethod "http://localhost:$Port/json" -ErrorAction Stop
$tab = $tabs | Where-Object { $_.url -like "*huikan*" } | Select-Object -First 1
if (-not $tab) { $tab = $tabs | Where-Object { $_.url -like "*kankanews*" -or $_.title -like "*新闻*" } | Select-Object -First 1 }
if (-not $tab) { $tab = $tabs | Select-Object -First 1 }
$wsUrl = $tab.webSocketDebuggerUrl
Write-Host "  Connected to: $($tab.title)"

# Get browser-level CDP endpoint (needed for Target.createTarget / closeTarget)
$ver = Invoke-RestMethod "http://localhost:$Port/json/version" -ErrorAction Stop
$browserWsUrl = $ver.webSocketDebuggerUrl

# Helper: evaluate JS via CDP
function EvalJS($id, $js) {
    $e = $js -replace '\\', '\\\\' -replace '"', '\"' -replace "`r`n", '\n' -replace "`r", '\n' -replace "`t", '\t'
    $json = "{`"id`":$id,`"method`":`"Runtime.evaluate`",`"params`":{`"expression`":`"$e`",`"awaitPromise`":true}}"
    return [CDP]::Send($wsUrl, $json) | ConvertFrom-Json
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
        $val = $r.result.result.value
        if ($val) { return $val }
    }
    return ''
}

# Bypass copyright shield
Write-Host "[2] Bypassing copyright shield..."
Start-Sleep 2
$r = EvalJS 1 @'
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
    if (h.programObj.is_shield !== 1) return "ALREADY";
    h.programObj.is_shield = 0;
    h.$forceUpdate();
    setTimeout(function() { try { h.initPlayer(); } catch(e) {} }, 100);
    return "OK";
})()
'@
$status = $r.result.result.value
Write-Host "  $([string]$status)"

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
    $playerResult = [CDP]::Send($browserWsUrl, "{`"id`":100,`"method`":`"Target.createTarget`",`"params`":{`"url`":`"$playerFileUrl`"}}") | ConvertFrom-Json
    $playerTargetId = $playerResult.result.targetId
    Write-Host "  Player opened (target: $playerTargetId). Close this window when done."
    Write-Host ""

    # Auto-refresh loop
    while ($true) {
        Start-Sleep ($IntervalMin * 60)
        Write-Host "[refresh] Getting new stream URL..."

        # Re-bypass shield and init new HLS stream
        $r = EvalJS 1 @'
(function() {
    var vue = document.querySelector("#__nuxt").__vue__;
    if (!vue) return;
    function find(c, n) {
        if (c.$options && c.$options.name === n) return c;
        for (var i = 0; c.$children && i < c.$children.length; i++) {
            var f = find(c.$children[i], n); if (f) return f;
        }
        return null;
    }
    var h = find(vue, "HuikanIndex");
    if (h && h.programObj) {
        if (h.programObj.is_shield === 1) h.programObj.is_shield = 0;
        h.$forceUpdate();
        setTimeout(function() { try { h.initPlayer(); } catch(e) {} }, 200);
    }
})()
'@
        Start-Sleep 5
        $newUrl = WaitForM3u8
        if ($newUrl -and $newUrl -ne $m3u8) {
            $m3u8 = $newUrl
            $enc = [System.Uri]::EscapeDataString($m3u8)
            $newPlayerUrl = "file:///$($PlayerPath.Replace('\','/'))#$enc"

            # Close old player tab
            [CDP]::Send($browserWsUrl, "{`"id`":200,`"method`":`"Target.closeTarget`",`"params`":{`"targetId`":`"$playerTargetId`"}}") >$null
            Write-Host "  Closed old player tab"

            # Open new player tab with fresh token
            Start-Sleep 1
            $playerResult = [CDP]::Send($browserWsUrl, "{`"id`":201,`"method`":`"Target.createTarget`",`"params`":{`"url`":`"$newPlayerUrl`"}}") | ConvertFrom-Json
            $playerTargetId = $playerResult.result.targetId
            Write-Host "  Stream refreshed (new target: $playerTargetId)"
        }
    }
} else {
    Write-Host "  Failed to get stream URL!"
    pause; exit 1
}

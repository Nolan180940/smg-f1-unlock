export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const type = url.searchParams.get('type')

  if (type === 'playlist') {
    return handlePlaylist(req, res)
  }

  if (type === 'ts') {
    return handleTs(req, res, url)
  }

  res.status(404).json({ error: 'Not found. Use ?type=playlist or ?type=ts&url=...' })
}

async function fetchStreamUrl() {
  const rawUrl = process.env.STREAM_URL_RAW
  if (!rawUrl) return null

  const resp = await fetch(rawUrl, { cache: 'no-store' })
  if (!resp.ok) return null
  return await resp.json()
}

async function tryFetchM3u8(m3u8Url) {
  const resp = await fetch(m3u8Url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.kankanews.com/'
    },
    cache: 'no-store'
  })
  if (!resp.ok) return null
  return await resp.text()
}

async function handlePlaylist(req, res) {
  const data = await fetchStreamUrl()
  if (!data || !data.m3u8Url) {
    return res.status(503).json({ error: 'No stream URL available' })
  }

  let m3u8Url = data.m3u8Url
  let text
  let source = 'cache'

  // Try 1: fetch from CDN with saved URL
  text = await tryFetchM3u8(m3u8Url)
  if (text) {
    source = 'cdn'
  } else {
    // Try 2: call kankanews API to get fresh stream URL
    try {
      const apiResp = await fetch('https://live.kankanews.com/content/pc/tv/huikan?id=10', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://live.kankanews.com/'
        },
        cache: 'no-store'
      })
      if (apiResp.ok) {
        const apiData = await apiResp.json()
        let streamUrl = null
        if (apiData.result && apiData.result.live_url) streamUrl = apiData.result.live_url
        else if (apiData.result && apiData.result.play_url) streamUrl = apiData.result.play_url
        else if (apiData.data && apiData.data.url) streamUrl = apiData.data.url

        if (streamUrl) {
          const freshText = await tryFetchM3u8(streamUrl)
          if (freshText) {
            text = freshText
            m3u8Url = streamUrl
            source = 'api'
          }
        }
      }
    } catch (e) {
      // API failed, continue to fallback
    }

    // Try 3: use cached m3u8 content
    if (!text && data.m3u8Content) {
      text = data.m3u8Content
      source = 'cache'
    }
  }

  if (!text) {
    return res.status(502).json({ error: 'No playlist available' })
  }

  const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1)
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const proxyBase = `${protocol}://${host}/api/proxy?type=ts&url=`

  const modified = text.replace(/^(?!#)(\S*\.ts(?:\?[^\s]*)?)$/gim, (_, tsPath) => {
    const absoluteUrl = tsPath.startsWith('http') ? tsPath : baseUrl + tsPath
    return proxyBase + encodeURIComponent(absoluteUrl)
  })

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('X-Playlist-Source', source)
  res.status(200).send(modified)
}

async function handleTs(req, res, url) {
  const tsUrl = url.searchParams.get('url')
  if (!tsUrl) {
    return res.status(400).json({ error: 'Missing url parameter' })
  }

  try {
    const tsResp = await fetch(tsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.kankanews.com/'
      }
    })
    if (!tsResp.ok) {
      return res.status(tsResp.status).json({ error: `CDN returned ${tsResp.status}` })
    }
    const buffer = Buffer.from(await tsResp.arrayBuffer())
    res.setHeader('Content-Type', 'video/MP2T')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(buffer)
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch TS: ${err.message}` })
  }
}

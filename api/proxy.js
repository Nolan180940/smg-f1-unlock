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

async function handlePlaylist(req, res) {
  const rawUrl = process.env.STREAM_URL_RAW
  if (!rawUrl) {
    return res.status(500).json({ error: 'STREAM_URL_RAW not configured' })
  }

  let data
  try {
    const resp = await fetch(rawUrl, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    data = await resp.json()
  } catch (err) {
    return res.status(503).json({ error: `Failed to fetch stream-url: ${err.message}` })
  }

  if (!data.m3u8Url) {
    return res.status(503).json({ error: 'No stream URL available' })
  }

  let text

  if (data.m3u8Content) {
    text = data.m3u8Content
  } else {
    const m3u8Url = data.m3u8Url
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1)

    try {
      const playlistResp = await fetch(m3u8Url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.kankanews.com/'
        }
      })
      if (!playlistResp.ok) throw new Error(`HTTP ${playlistResp.status}`)
      text = await playlistResp.text()
    } catch (err) {
      return res.status(502).json({ error: `Failed to fetch playlist: ${err.message}` })
    }
  }

  const m3u8Url = data.m3u8Url
  const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1)
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const proxyBase = `${protocol}://${host}/api/proxy?type=ts&url=`

  const modified = text.replace(/^(?!#)(\S*\.ts(?:\?[^\s]*)?)$/gim, (_, tsPath) => {
    const absoluteUrl = tsPath.startsWith('http') ? tsPath : baseUrl + tsPath
    return proxyBase + encodeURIComponent(absoluteUrl)
  })

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
  res.setHeader('Cache-Control', 'no-cache')
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
      return res.status(502).json({ error: `CDN returned ${tsResp.status} for TS` })
    }
    const buffer = Buffer.from(await tsResp.arrayBuffer())
    res.setHeader('Content-Type', 'video/MP2T')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.status(200).send(buffer)
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch TS: ${err.message}` })
  }
}

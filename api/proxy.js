export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const type = url.searchParams.get('type')

  if (type === 'playlist') return handlePlaylist(req, res)
  if (type === 'ts') return handleTs(req, res, url)

  res.status(404).json({ error: 'Not found' })
}

async function handlePlaylist(req, res) {
  const rawUrl = process.env.STREAM_URL_RAW
  if (!rawUrl) return res.status(500).json({ error: 'STREAM_URL_RAW not configured' })

  let data
  try {
    const resp = await fetch(rawUrl, { cache: 'no-store' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    data = await resp.json()
  } catch (err) {
    return res.status(503).json({ error: 'Failed to fetch stream-url: ' + err.message })
  }

  if (!data.m3u8Url) return res.status(503).json({ error: 'No stream URL' })

  let text, m3u8Url = data.m3u8Url, source = 'cache'

  try {
    const r = await fetch(m3u8Url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Windows', 'Referer': 'https://www.kankanews.com/' },
      cache: 'no-store'
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    text = await r.text()
    source = 'cdn'
  } catch (e) {
    if (data.m3u8Content) { text = data.m3u8Content; source = 'cache' }
    else return res.status(502).json({ error: 'Failed to fetch: ' + e.message })
  }

  const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1)
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const proxyBase = `${protocol}://${host}/api/proxy?type=ts&url=`

  const modified = text.replace(/^(?!#)(\S*\.ts(?:\?[^\s]*)?)$/gim, (_, tsPath) => {
    const abs = tsPath.startsWith('http') ? tsPath : baseUrl + tsPath
    return proxyBase + encodeURIComponent(abs)
  })

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(modified)
}

async function handleTs(req, res, url) {
  const tsUrl = url.searchParams.get('url')
  if (!tsUrl) return res.status(400).json({ error: 'Missing url' })

  try {
    const r = await fetch(tsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 Windows', 'Referer': 'https://www.kankanews.com/' }
    })
    if (!r.ok) return res.status(r.status).end()
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'video/MP2T')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(buf)
  } catch (e) {
    return res.status(502).end()
  }
}

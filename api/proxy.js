export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const type = url.searchParams.get('type')

  if (type === 'ts') return handleTs(req, res, url)
  if (type === 'stream') return handleStream(req, res)

  res.status(404).json({ error: 'Not found' })
}

async function handleStream(req, res) {
  const rawUrl = process.env.STREAM_URL_RAW
  if (!rawUrl) return res.status(500).json({ error: 'STREAM_URL_RAW not configured' })
  try {
    const resp = await fetch(rawUrl, { cache: 'no-store' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    if (!data.m3u8Url) return res.status(503).json({ error: 'No stream URL' })
    res.json({ url: data.m3u8Url })
  } catch (e) {
    res.status(503).json({ error: e.message })
  }
}

async function handleTs(req, res, url) {
  const tsUrl = url.searchParams.get('url')
  if (!tsUrl) return res.status(400).json({ error: 'Missing url' })
  try {
    const r = await fetch(tsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 Windows', 'Referer': 'https://www.kankanews.com/' }
    })
    if (!r.ok) return res.status(r.status).end()
    res.setHeader('Content-Type', 'video/MP2T')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    res.status(502).end()
  }
}

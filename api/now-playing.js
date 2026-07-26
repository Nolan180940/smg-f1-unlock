export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  const rawUrl = process.env.STREAM_URL_RAW
  if (!rawUrl) {
    return res.status(200).json({ online: false, title: 'SMG Five Sports' })
  }

  try {
    const resp = await fetch(rawUrl)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()

    res.status(200).json({
      online: !!data.m3u8Url,
      updatedAt: data.updatedAt || null,
      title: data.title || 'SMG Five Sports'
    })
  } catch (err) {
    res.status(200).json({ online: false, title: 'SMG Five Sports' })
  }
}

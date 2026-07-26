import { supabase } from './_db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown'

  let country = null
  let city = null

  if (ip && ip !== 'unknown' && ip !== '127.0.0.1' && ip !== '::1') {
    try {
      const geoResp = await fetch(`http://ip-api.com/json/${ip}?fields=country,city`)
      if (geoResp.ok) {
        const geo = await geoResp.json()
        country = geo.country || null
        city = geo.city || null
      }
    } catch (e) {
      // geo lookup failed silently
    }
  }

  const { error } = await supabase.from('visits').insert({ ip, country, city })

  if (error) {
    console.error('Failed to log visit:', error)
  }

  res.status(200).json({ ok: true })
}

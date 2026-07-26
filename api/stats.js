import { supabase } from './_db.js'

const STATS_KEY = process.env.STATS_KEY || 'changeme'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html')
  res.setHeader('X-Robots-Tag', 'noindex')

  const key = req.query?.key
  if (key !== STATS_KEY) {
    return res.status(403).send('<h1>403 Forbidden</h1>')
  }

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString()

  const [totalResult, lastHourResult, visitorsResult] = await Promise.all([
    supabase.from('visits').select('*', { count: 'exact', head: true }),
    supabase.from('visits').select('*', { count: 'exact', head: true }).gte('visited_at', oneHourAgo),
    supabase.from('visits').select('ip, country, city, visited_at').order('visited_at', { ascending: false }).limit(500)
  ])

  const total = totalResult.count ?? 0
  const lastHour = lastHourResult.count ?? 0
  const visitors = visitorsResult.data ?? []
  const uniqueIps = [...new Set(visitors.map(v => v.ip))]

  const rows = visitors.map(v => {
    const time = new Date(v.visited_at).toLocaleString()
    return `<tr><td>${esc(v.ip)}</td><td>${esc(v.country || '-')}</td><td>${esc(v.city || '-')}</td><td>${esc(time)}</td></tr>`
  }).join('')

  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stats - SMG Five Sports</title>
<meta name="robots" content="noindex">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:900px;margin:0 auto;padding:20px;background:#fafafa}
h1{font-size:1.5rem;margin-bottom:1rem}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:2rem}
.stat{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px 24px;text-align:center;min-width:100px}
.stat-num{font-size:1.8rem;font-weight:700}
.stat-label{font-size:0.75rem;color:#777;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #eee;font-size:0.875rem}
th{background:#f5f5f5;font-weight:600;color:#444}
tr:last-child td{border-bottom:none}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}.stat,.table{background:#1a1a1a;border-color:#333}th{background:#222;color:#ccc}td{border-color:#222}}
</style>
</head>
<body>
<h1>Visitor Stats</h1>
<div class="stats">
<div class="stat"><div class="stat-num">${total}</div><div class="stat-label">Total Visits</div></div>
<div class="stat"><div class="stat-num">${lastHour}</div><div class="stat-label">Last Hour</div></div>
<div class="stat"><div class="stat-num">${uniqueIps.length}</div><div class="stat-label">Unique IPs</div></div>
</div>
<table>
<thead><tr><th>IP</th><th>Country</th><th>City</th><th>Time</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4">No visits yet</td></tr>'}</tbody>
</table>
</body>
</html>`)
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

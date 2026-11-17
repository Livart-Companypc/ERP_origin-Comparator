import { fetchOrigins } from './_originCore.js'

// GET /api/origin?codes=P1,P2,...  → { P1: { ok, origins: [...] }, ... }
export default async function handler(req, res) {
  const codes = [...new Set(String(req.query?.codes || '').split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 30)
  if (codes.length === 0) return res.status(400).json({ error: 'codes required' })
  const data = await fetchOrigins(codes)
  res.setHeader('Cache-Control', 'public, s-maxage=3600')
  return res.status(200).json(data)
}

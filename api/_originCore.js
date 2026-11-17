// 리바트몰 상품 페이지(/p/{P코드})에서 원산지 블록을 읽어온다.
const BASE = 'https://living.hyundailivart.co.kr/p/'

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

const ORIGIN_BLOCK =
  /<p[^>]*pitem-info__subtitle[^>]*>\s*원산지\s*<\/p>\s*<p[^>]*pitem-info__text[^>]*>([\s\S]*?)<\/p>/g

export const parseOrigins = (html) => {
  const origins = []
  let m
  ORIGIN_BLOCK.lastIndex = 0
  while ((m = ORIGIN_BLOCK.exec(html)) !== null) {
    const text = stripTags(m[1])
    if (text) origins.push(text)
  }
  return origins
}

export const fetchOrigin = async (code) => {
  if (!/^P\d+$/i.test(code)) return { code, ok: false, error: 'invalid code', origins: [] }
  try {
    const res = await fetch(BASE + code, {
      headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ko' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { code, ok: false, error: `HTTP ${res.status}`, origins: [] }
    const html = await res.text()
    return { code, ok: true, origins: parseOrigins(html) }
  } catch (e) {
    return { code, ok: false, error: String(e?.cause?.code || e?.message || e), origins: [] }
  }
}

export const fetchOrigins = async (codes, concurrency = 10) => {
  const out = {}
  let i = 0
  const worker = async () => {
    while (i < codes.length) {
      const code = codes[i++]
      out[code] = await fetchOrigin(code)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, codes.length) }, worker))
  return out
}

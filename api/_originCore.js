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

// 1) 기술서 본문의 "원산지/제조국" 제목 + 바로 아래 값
const ORIGIN_BLOCK =
  /<p[^>]*pitem-info__subtitle[^>]*>\s*(?:원산지|제조국)\s*:?\s*<\/p>\s*<p[^>]*pitem-info__text[^>]*>([\s\S]*?)<\/p>/g
// 2) 상품정보고시 표의 "원산지/제조국" 항목
const ORIGIN_TABLE = /<dt[^>]*>\s*(?:원산지|제조국)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g

const collect = (html, regex) => {
  const out = []
  let m
  regex.lastIndex = 0
  while ((m = regex.exec(html)) !== null) {
    const text = stripTags(m[1])
    if (text) out.push(text)
  }
  return out
}

// 원산지/제조국이라는 이름으로 적힌 값만 가져온다. 본문 블록이 있으면 그것을, 없으면 상품정보고시 표 값을 쓴다.
export const parseOrigins = (html) => {
  const block = collect(html, ORIGIN_BLOCK)
  if (block.length > 0) return [...new Set(block)]
  return [...new Set(collect(html, ORIGIN_TABLE))]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fetchOnce = async (code) => {
  const res = await fetch(BASE + code, {
    headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ko' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// 동시 요청이 몰리면 원산지 블록이 빠진 불완전한 응답이 오는 경우가 있어, 비어 있으면 몇 번 더 확인한다
export const fetchOrigin = async (code) => {
  if (!/^P\d+$/i.test(code)) return { code, ok: false, error: 'invalid code', origins: [] }
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt)
    try {
      const html = await fetchOnce(code)
      const origins = parseOrigins(html)
      if (origins.length > 0) return { code, ok: true, origins }
      lastError = ''
    } catch (e) {
      lastError = String(e?.cause?.code || e?.message || e)
    }
  }
  // 3번 모두 원산지가 없으면 진짜 없는 것, 모두 에러면 조회 실패
  return lastError ? { code, ok: false, error: lastError, origins: [] } : { code, ok: true, origins: [] }
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

// 사용법: npm run build:origins
// public/defaults/상품기술서.xlsx 의 P코드를 리바트몰 상품 페이지에서 조회해 public/defaults/web-origins.json 으로 저장한다.
// (사내망 인증서 때문에 TLS 검증을 끈다. 로컬에서만 실행할 것)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { readFileSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { fetchOrigins } from '../api/_originCore.js'

const SRC = 'public/defaults/상품기술서.xlsx'
const OUT = 'public/defaults/web-origins.json'

const clean = (v) => String(v ?? '').replace(/\s+/g, '').trim()
const wb = XLSX.read(readFileSync(SRC), { type: 'buffer' })
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })

const codes = new Set()
for (const row of rows) {
  const r = Object.fromEntries(Object.entries(row).map(([k, v]) => [clean(k), clean(v)]))
  if (!r['하위P코드']) continue
  const code = r['대표P코드'] || r['하위P코드']
  if (/^P\d+$/i.test(code)) codes.add(code)
}

const list = [...codes]
console.log(`조회 대상 ${list.length}건`)

const data = {}
const BATCH = 100
for (let i = 0; i < list.length; i += BATCH) {
  Object.assign(data, await fetchOrigins(list.slice(i, i + BATCH), 6))
  console.log(`${Math.min(i + BATCH, list.length)}/${list.length}`)
}

const failed = Object.values(data).filter((v) => !v.ok)
// 실패한 건은 저장하지 않아 앱에서 다시 조회하게 한다
const okOnly = Object.fromEntries(Object.entries(data).filter(([, v]) => v.ok))
writeFileSync(OUT, JSON.stringify({ savedAt: Date.now(), data: okOnly }))
console.log(`저장 완료: ${Object.keys(okOnly).length}건, 실패 ${failed.length}건 → ${OUT}`)

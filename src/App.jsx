import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import './App.css'

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'matched', label: '일치' },
  { key: 'missing_origin', label: 'ERP 원산지 누락' },
  { key: 'mismatch', label: '불일치' },
  { key: 'empty_product', label: '기술서 원산지 비어있음' },
  { key: 'multiple_origin', label: 'ERP 원산지 여러개' },
]

const STATUS_META = {
  matched: { label: '일치', className: 'success' },
  missing_origin: { label: 'ERP 누락', className: 'warning' },
  mismatch: { label: '불일치', className: 'danger' },
  empty_product: { label: '기술서 누락', className: 'warning' },
  multiple_origin: { label: '합집합', className: 'info' },
  missing_erp_code: { label: 'ERP 누락', className: 'muted' },
}

const normalizeText = (value) => {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

const normalizeHeader = (header) => {
  return normalizeText(header).replace(/\s+/g, '').replace(/\u00A0/g, '')
}

const normalizeCountry = (value) => {
  const text = normalizeText(value)
  if (!text) return ''

  const cleaned = text
    .replace(/원산지/gi, '')
    .replace(/[:：]/g, '')
    .replace(/\./g, '')
    .trim()
    .toLowerCase()

  if (!cleaned) return ''

  if (/(대한민국|한국|korea|kr|republic of korea)/.test(cleaned)) return '한국'
  if (/(중국|china|cn)/.test(cleaned)) return '중국'
  if (/(베트남|vietnam|vn)/.test(cleaned)) return '베트남'
  if (/(미국|usa|us|united states)/.test(cleaned)) return '미국'
  if (/(일본|japan|jp)/.test(cleaned)) return '일본'
  if (/(독일|germany|de)/.test(cleaned)) return '독일'
  if (/(태국|thailand|th)/.test(cleaned)) return '태국'
  if (/(인도|india|in)/.test(cleaned)) return '인도'
  if (/(말레이시아|malaysia|malaysian|my)/.test(cleaned)) return '말레이시아'

  return text.trim()
}

const findOriginInDescription = (description = '') => {
  const text = normalizeText(description)
  if (!text) return ''

  const pattern = /(원산지\s*[:：]?\s*([가-힣A-Za-z0-9()\-/·\s]{0,30}))/i
  const match = text.match(pattern)
  if (match && match[2]) {
    return normalizeCountry(match[2])
  }

  const countryMatch = text.match(
    /(대한민국|한국|중국|베트남|미국|일본|독일|태국|말레이시아|Korea|China|Vietnam|USA|Japan|Germany|Thailand|Malaysia|MALAYSIA)/i,
  )

  if (countryMatch) {
    return normalizeCountry(countryMatch[0])
  }

  return ''
}

const toWorkbookRows = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    defval: '',
    raw: false,
  })

  return rows.map((row) => {
    const cleanRow = {}
    Object.entries(row).forEach(([key, value]) => {
      cleanRow[normalizeHeader(key)] = value
    })
    return cleanRow
  })
}

const parseProducts = (rows) =>
  rows.map((row) => ({
    대표P코드: normalizeText(row.대표P코드),
    하위P코드: normalizeText(row.하위P코드),
    상품명: normalizeText(row.상품명),
    ERP코드: normalizeText(row.ERP코드),
    ERP원산지: normalizeText(row.ERP원산지),
    상품기술서내용: normalizeText(row.상품기술서내용),
  }))

const compareFiles = (productRows, originRows) => {
  const originMap = new Map()

  originRows.forEach((row) => {
    const setCode = normalizeText(row.세트코드)
    if (!setCode) return

    const value = normalizeCountry(row.원산지)
    if (!originMap.has(setCode)) originMap.set(setCode, [])
    if (value) originMap.get(setCode).push(value)
  })

  const results = productRows
    .filter((row) => row.대표P코드 || row.하위P코드 || row.ERP코드 || row.상품명)
    .filter((row) => row.하위P코드)
    .map((row) => {
      const erpCode = row.ERP코드
      const rawOriginValues = originMap.get(erpCode) || []
      const uniqueOriginValues = [...new Set(rawOriginValues)]
      const expectedOrigin = uniqueOriginValues.length > 0 ? uniqueOriginValues.join(', ') : ''

      const techOriginField = normalizeCountry(row.ERP원산지)
      const detailedOrigin = findOriginInDescription(row.상품기술서내용)
      const productOrigin = techOriginField || detailedOrigin

      let status = 'matched'
      let message = '상품기술서 원산지가 ERP 기준과 일치합니다.'

      if (!erpCode) {
        status = 'missing_erp_code'
        message = 'ERP 코드가 비어 있어 비교 대상이 없습니다.'
      } else if (uniqueOriginValues.length === 0) {
        status = 'missing_origin'
        message = 'ERP 상 원산지 등록 필요'
      } else if (uniqueOriginValues.length > 1) {
        status = 'multiple_origin'
        message = `ERP 원산지 여러개: ${uniqueOriginValues.join(', ')}`
      } else if (!productOrigin) {
        status = 'empty_product'
        message = '상품기술서에서 원산지를 찾지 못했습니다.'
      } else if (normalizeCountry(expectedOrigin) !== normalizeCountry(productOrigin)) {
        status = 'mismatch'
        message = '기술서 원산지와 ERP 원산지가 서로 다릅니다.'
      }

      return {
        대표P코드: row.대표P코드,
        하위P코드: row.하위P코드,
        상품명: row.상품명,
        ERP코드: erpCode,
        expectedOrigin: expectedOrigin || '없음',
        productOrigin: productOrigin || '없음',
        sourceOrigin: techOriginField || detailedOrigin || '없음',
        originValues: uniqueOriginValues,
        status,
        message,
      }
    })

  const counts = {
    all: results.length,
    matched: results.filter((item) => item.status === 'matched').length,
    missing_origin: results.filter((item) => item.status === 'missing_origin').length,
    mismatch: results.filter((item) => item.status === 'mismatch').length,
    empty_product: results.filter((item) => item.status === 'empty_product').length,
    multiple_origin: results.filter((item) => item.status === 'multiple_origin').length,
  }

  return { results, counts }
}

const DEFAULT_FILES = {
  product: '/defaults/상품기술서.xlsx',
  origin: '/defaults/실제ERP_원산지정보.xlsx',
}

function App() {
  const [productFile, setProductFile] = useState(null)
  const [originFile, setOriginFile] = useState(null)
  const [results, setResults] = useState([])
  const [counts, setCounts] = useState({ all: 0, matched: 0, missing_origin: 0, mismatch: 0, empty_product: 0, multiple_origin: 0 })
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isCustomUpload, setIsCustomUpload] = useState(false)
  const productInputRef = useRef(null)
  const originInputRef = useRef(null)

  const openUploadPicker = (type) => {
    if (type === 'product') {
      productInputRef.current?.click()
      return
    }

    originInputRef.current?.click()
  }

  const loadDefaultFiles = async () => {
    const defaultProduct = await fetch(DEFAULT_FILES.product).then((res) => res.blob())
    const defaultOrigin = await fetch(DEFAULT_FILES.origin).then((res) => res.blob())

    const product = new File([defaultProduct], '상품기술서.xlsx', { type: defaultProduct.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const origin = new File([defaultOrigin], '실제ERP_원산지정보.xlsx', { type: defaultOrigin.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    setProductFile(product)
    setOriginFile(origin)
    setIsCustomUpload(false)

    return { product, origin }
  }

  useEffect(() => {
    let active = true

    const init = async () => {
      const defaultFiles = await loadDefaultFiles()
      if (!active) return
      const [productBuffer, originBuffer] = await Promise.all([
        defaultFiles.product.arrayBuffer(),
        defaultFiles.origin.arrayBuffer(),
      ])

      const productRows = parseProducts(toWorkbookRows(productBuffer))
      const originRows = toWorkbookRows(originBuffer)
      const { results: nextResults, counts: nextCounts } = compareFiles(productRows, originRows)

      setResults(nextResults)
      setCounts(nextCounts)
    }

    init()

    return () => {
      active = false
    }
  }, [])

  const handleFileUpload = async (event, type) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return

    if (type === 'product') {
      setProductFile(selectedFile)
    } else {
      setOriginFile(selectedFile)
    }

    setIsCustomUpload(true)
  }

  const runAnalysis = async () => {
    const activeProduct = productFile
    const activeOrigin = originFile

    if (!activeProduct || !activeOrigin) return

    const [productBuffer, originBuffer] = await Promise.all([
      activeProduct.arrayBuffer(),
      activeOrigin.arrayBuffer(),
    ])

    const productRows = parseProducts(toWorkbookRows(productBuffer))
    const originRows = toWorkbookRows(originBuffer)
    const { results: nextResults, counts: nextCounts } = compareFiles(productRows, originRows)

    setResults(nextResults)
    setCounts(nextCounts)
    setActiveFilter('all')
  }

  const filteredResults = useMemo(() => {
    const normalizedQuery = normalizeText(searchTerm).toLowerCase()
    let nextResults = results

    if (normalizedQuery) {
      nextResults = nextResults.filter((item) => {
        const targetText = [
          item.대표P코드,
          item.하위P코드,
          item.상품명,
          item.ERP코드,
        ]
          .join(' ')
          .toLowerCase()

        return targetText.includes(normalizedQuery)
      })
    }

    if (activeFilter !== 'all') {
      nextResults = nextResults.filter((item) => item.status === activeFilter)
    }

    return nextResults
  }, [results, activeFilter, searchTerm])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="LIVART logo">
          <img src="/images/livart_logo.svg" alt="LIVART logo" className="brand-logo" />
        </div>
      </header>

      <main className="page-content">
        <section className="upload-panel panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ERP 원산지 검증</p>
              <h1>상품기술서 / ERP 원산지 비교</h1>
            </div>
            <button
              type="button"
              className="primary-btn reupload-btn"
              onClick={runAnalysis}
              disabled={!productFile || !originFile}
            >
              {isCustomUpload ? '재업로드 기준으로 분석' : '기본 파일 기준 분석'}
            </button>
          </div>

          <div className="upload-grid">
            <div className="upload-card">
              <span className="upload-title">실제 ERP 코드 파일</span>
              <span className="upload-subtitle">원산지 정보 엑셀</span>
              <input ref={originInputRef} type="file" accept=".xlsx,.xls" onChange={(event) => handleFileUpload(event, 'origin')} />
              <span className="file-name">{originFile ? originFile.name : '기본 파일 로드됨'}</span>
              <button type="button" className="secondary-btn" onClick={() => openUploadPicker('origin')}>
                재업로드
              </button>
            </div>

            <div className="upload-card">
              <span className="upload-title">상품 기술서 파일</span>
              <span className="upload-subtitle">기술서 상세 내용 엑셀</span>
              <input ref={productInputRef} type="file" accept=".xlsx,.xls" onChange={(event) => handleFileUpload(event, 'product')} />
              <span className="file-name">{productFile ? productFile.name : '기본 파일 로드됨'}</span>
              <button type="button" className="secondary-btn" onClick={() => openUploadPicker('product')}>
                재업로드
              </button>
            </div>
          </div>
        </section>

        <section className="summary-grid">
          <div className="stat-card accent">
            <span className="stat-label">총 항목</span>
            <strong>{counts.all}</strong>
          </div>
          <div className="stat-card success">
            <span className="stat-label">일치</span>
            <strong>{counts.matched}</strong>
          </div>
          <div className="stat-card warning">
            <span className="stat-label">누락 / 비어 있음</span>
            <strong>{counts.missing_origin + counts.empty_product}</strong>
          </div>
          <div className="stat-card danger">
            <span className="stat-label">불일치</span>
            <strong>{counts.mismatch}</strong>
          </div>
        </section>

        <section className="panel results-panel">
          <div className="results-header">
            <div>
              <p className="eyebrow">검증 결과</p>
              <h2>이슈 목록</h2>
            </div>
          </div>

          <div className="results-toolbar">
            <label className="search-box" aria-label="검색">
              <span className="search-icon">⌕</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="P코드, 제품명, 하위P코드, ERP코드 검색"
              />
            </label>

            <div className="filter-bar" aria-label="필터 목록">
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={activeFilter === filter.key ? 'filter-button active' : 'filter-button'}
                  onClick={() => setActiveFilter(filter.key)}
                >
                  {filter.label}
                  {filter.key === 'all' ? ` (${counts.all})` : ` (${counts[filter.key] ?? 0})`}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>대표P코드</th>
                  <th>하위P코드</th>
                  <th>상품명</th>
                  <th>ERP코드</th>
                  <th>ERP 등록 원산지</th>
                  <th>상품기술서 원산지</th>
                  <th>상태</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="empty-state">
                      파일을 업로드하고 분석을 실행하면 결과가 여기에 표시됩니다.
                    </td>
                  </tr>
                ) : (
                  filteredResults.map((item, index) => (
                    <tr key={`${item.대표P코드}-${item.ERP코드}-${index}`}>
                      <td>{item.대표P코드 || '-'}</td>
                      <td>{item.하위P코드 || '-'}</td>
                      <td className="product-name">{item.상품명 || '-'}</td>
                      <td>{item.ERP코드 || '-'}</td>
                      <td>{item.expectedOrigin || '없음'}</td>
                      <td>{item.productOrigin || '없음'}</td>
                      <td>
                        <span className={`status-badge ${STATUS_META[item.status]?.className || 'muted'}`}>
                          {STATUS_META[item.status]?.label || '확인' }
                        </span>
                      </td>
                      <td className="note-cell">{item.message}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App

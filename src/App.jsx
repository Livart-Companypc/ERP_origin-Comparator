import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import './App.css'

const TOP_LEVEL_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'matched', label: '일치' },
  {
    key: 'needs_attention',
    label: '수정 필요',
    children: [
      { key: 'attention_all', label: '전체' },
      { key: 'missing_origin', label: 'ERP 쪽 원산지 누락' },
      { key: 'empty_product', label: '기술서 쪽 원산지 누락' },
      { key: 'mismatch', label: '아예 다름' },
      { key: 'multiple_origin', label: '원산지 여러개로 처리 필요' },
    ],
  },
]

const STATUS_META = {
  matched: { label: '일치', className: 'success' },
  missing_origin: { label: 'ERP 누락', className: 'warning' },
  mismatch: { label: '불일치', className: 'danger' },
  empty_product: { label: '기술서 누락', className: 'warning' },
  multiple_origin: { label: '여러개 처리 필요', className: 'info' },
  missing_erp_code: { label: 'ERP 누락', className: 'muted' },
}

const normalizeText = (value) => {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

const normalizeHeader = (header) => {
  return normalizeText(header).replace(/\s+/g, '').replace(/\u00A0/g, '')
}

const COUNTRY_ALIASES = [
  ['한국', ['대한민국', '한국', '국산', 'republic of korea', 'south korea', 'korea', 'kr']],
  ['중국', ['중국', 'china', 'prc', 'cn']],
  ['베트남', ['베트남', 'vietnam', 'viet nam', 'vn']],
  ['미국', ['미국', 'united states', 'usa', 'us']],
  ['일본', ['일본', 'japan', 'jp']],
  ['독일', ['독일', 'germany', 'de']],
  ['태국', ['태국', 'thailand', 'th']],
  ['인도네시아', ['인도네시아', 'indonesia', 'id']],
  ['인도', ['인도', 'india', 'in']],
  ['말레이시아', ['말레이시아', 'malaysia', 'my']],
  ['대만', ['대만', 'taiwan', 'tw']],
  ['이탈리아', ['이탈리아', 'italy']],
  ['프랑스', ['프랑스', 'france']],
  ['터키', ['터키', '튀르키예', 'turkey']],
  ['폴란드', ['폴란드', 'poland']],
  ['필리핀', ['필리핀', 'philippines']],
]

const escapeRegExp = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 설명문 스캔용: 2글자 영문코드는 오탐이 많아 제외하고, 영문은 단어 경계로 매칭
const SCAN_PATTERNS = COUNTRY_ALIASES.map(([country, aliases]) => {
  const parts = aliases
    .filter((a) => !(/^[a-z]{2}$/.test(a)))
    .map((a) => (/^[a-z ]+$/.test(a) ? `(?<![A-Za-z])${escapeRegExp(a)}(?![A-Za-z])` : escapeRegExp(a)))
  return [country, new RegExp(parts.join('|'), 'gi')]
})

// 값 자체가 국가인지 판단 (완전 일치 기준)
const normalizeCountry = (value) => {
  const text = normalizeText(value)
  if (!text) return ''

  const cleaned = text
    .replace(/원산지/gi, '')
    .replace(/[:：.()[\]]/g, '')
    .trim()
    .toLowerCase()

  if (!cleaned) return ''

  for (const [country, aliases] of COUNTRY_ALIASES) {
    if (aliases.includes(cleaned)) return country
  }
  for (const [country, aliases] of COUNTRY_ALIASES) {
    if (aliases.some((a) => a.length > 2 && cleaned.includes(a))) return country
  }

  return text.trim()
}

const isKnownCountry = (value) => COUNTRY_ALIASES.some(([country]) => country === value)

// 텍스트 내 모든 국가 키워드와 위치
const scanCountries = (text) => {
  const found = []
  SCAN_PATTERNS.forEach(([country, regex]) => {
    regex.lastIndex = 0
    let m
    while ((m = regex.exec(text)) !== null) {
      found.push({ country, index: m.index })
      if (m[0].length === 0) regex.lastIndex += 1
    }
  })
  return found.sort((x, y) => x.index - y.index)
}

// 기술서에서 원산지 추출: 1) "원산지" 표기 근처 국가 2) 그 외 본문 국가(뒤쪽 우선)
const findOriginInDescription = (description = '') => {
  const text = normalizeText(description)
  if (!text) return { origins: [], labeled: false }

  const labeled = []
  const labelRegex = /(원산지|제조국|생산국|Made in)\s*[:：]?\s*/gi
  let m
  while ((m = labelRegex.exec(text)) !== null) {
    const segment = text.slice(m.index + m[0].length, m.index + m[0].length + 25)
    const first = scanCountries(segment)[0]
    if (first) labeled.push(first.country)
  }
  if (labeled.length > 0) return { origins: [...new Set(labeled)], labeled: true }

  const all = scanCountries(text)
  const ordered = [...all].reverse().map((x) => x.country)
  return { origins: [...new Set(ordered)], labeled: false }
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

      const techOriginRaw = normalizeCountry(row.ERP원산지)
      const techOriginField = isKnownCountry(techOriginRaw) ? techOriginRaw : ''
      const { origins: descOrigins } = findOriginInDescription(row.상품기술서내용)
      // ERP 원산지 키워드가 기술서에 있으면 우선 노출
      const matchedErp = uniqueOriginValues.filter((v) => descOrigins.includes(v))
      const productOriginList = matchedErp.length > 0 ? matchedErp : descOrigins.length > 0 ? [descOrigins[0]] : techOriginField ? [techOriginField] : []
      const productOrigin = productOriginList.join(', ')
      const detailedOrigin = productOrigin

      let status = 'matched'
      let message = '일치'

      if (!erpCode) {
        status = 'missing_erp_code'
        message = 'ERP 코드가 비어 있어 비교 대상이 없음'
      } else if (uniqueOriginValues.length === 0) {
        status = 'missing_origin'
        message = 'ERP 쪽 원산지 등록 필요'
      } else if (uniqueOriginValues.length > 1) {
        status = 'multiple_origin'
        message = `ERP 원산지 여러개: ${uniqueOriginValues.join(', ')}`
      } else if (!productOrigin) {
        status = 'empty_product'
        message = '상품기술서 쪽 원산지 누락'
      } else if (matchedErp.length === 0 && !productOriginList.includes(expectedOrigin)) {
        status = 'mismatch'
        message = '기술서 원산지와 ERP 원산지가 서로 불일치'
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

const getGroupStatus = (items) => {
  if (!items.length) return 'matched'

  const priorities = {
    mismatch: 5,
    missing_origin: 4,
    empty_product: 3,
    multiple_origin: 2,
    missing_erp_code: 1,
    matched: 0,
  }

  return items.reduce((highest, item) => {
    const current = priorities[item.status] ?? 0
    return current > priorities[highest] ? item.status : highest
  }, items[0].status)
}

const buildGroupedResults = (results) => {
  const groups = new Map()

  results.forEach((item) => {
    const key = normalizeText(item.대표P코드) || `unassigned-${normalizeText(item.하위P코드) || normalizeText(item.ERP코드) || 'unknown'}`

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        대표P코드: item.대표P코드 || '미분류',
        상품명: item.상품명 || '미분류',
        children: [],
      })
    }

    groups.get(key).children.push(item)
  })

  return [...groups.values()].map((group) => {
    const children = group.children
    const groupStatus = getGroupStatus(children)
    const groupMessage =
      groupStatus === 'matched'
        ? '모든 하위 옵션이 일치.'
        : groupStatus === 'mismatch'
          ? '하위 옵션 중 일부 불일치 존재.'
          : groupStatus === 'missing_origin'
            ? '하위 옵션 중 ERP 쪽 원산지 누락'
            : groupStatus === 'empty_product'
              ? '하위 옵션 중 기술서 쪽 원산지 누락'
              : groupStatus === 'multiple_origin'
                ? '하위 옵션 중 ERP 원산지가 여러 개 있음'
                : '하위 옵션 중 일부 비교가 불가능합니다.'

    const erpCodes = [...new Set(children.map((item) => normalizeText(item.ERP코드)).filter(Boolean))]
    const expectedOrigins = [...new Set(children.flatMap((item) => item.originValues || []).filter(Boolean))]
    const productOrigins = [...new Set(children.map((item) => normalizeText(item.productOrigin)).filter((value) => value && value !== '없음'))]

    return {
      ...group,
      children,
      groupStatus,
      groupMessage,
      erpCodes,
      expectedOrigins,
      productOrigins,
      하위개수: children.length,
    }
  })
}

function App() {
  const [productFile, setProductFile] = useState(null)
  const [originFile, setOriginFile] = useState(null)
  const [results, setResults] = useState([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [activeDetailFilter, setActiveDetailFilter] = useState('attention_all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isCustomUpload, setIsCustomUpload] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState({})
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set())
  const [hasUserSelection, setHasUserSelection] = useState(false)
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
      const { results: nextResults } = compareFiles(productRows, originRows)

      setResults(nextResults)
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
    const { results: nextResults } = compareFiles(productRows, originRows)

    setResults(nextResults)
    setActiveFilter('all')
  }

  const groupedResults = useMemo(() => buildGroupedResults(results), [results])

  const counts = useMemo(() => {
    const countsMap = {
      all: groupedResults.length,
      matched: 0,
      missing_origin: 0,
      mismatch: 0,
      empty_product: 0,
      multiple_origin: 0,
    }

    groupedResults.forEach((group) => {
      if (group.groupStatus === 'matched') countsMap.matched += 1
      if (group.groupStatus === 'missing_origin') countsMap.missing_origin += 1
      if (group.groupStatus === 'mismatch') countsMap.mismatch += 1
      if (group.groupStatus === 'empty_product') countsMap.empty_product += 1
      if (group.groupStatus === 'multiple_origin') countsMap.multiple_origin += 1
    })

    return countsMap
  }, [groupedResults])

  const needsAttentionCount = useMemo(
    () => groupedResults.filter((group) => group.groupStatus !== 'matched').length,
    [groupedResults],
  )

  const effectiveFilter = activeFilter === 'needs_attention' ? activeDetailFilter : activeFilter

  const filteredGroups = useMemo(() => {
    const normalizedQuery = normalizeText(searchTerm).toLowerCase()
    let nextGroups = groupedResults

    if (normalizedQuery) {
      nextGroups = nextGroups.filter((group) => {
        const groupText = [
          group.대표P코드,
          group.상품명,
          group.erpCodes.join(' '),
          group.children.map((item) => item.하위P코드).join(' '),
        ].join(' ').toLowerCase()

        return groupText.includes(normalizedQuery)
      })
    }

    if (effectiveFilter !== 'all') {
      if (effectiveFilter === 'matched') {
        nextGroups = nextGroups.filter((group) => group.groupStatus === 'matched')
      } else if (effectiveFilter === 'attention_all') {
        nextGroups = nextGroups.filter((group) => group.groupStatus !== 'matched')
      } else {
        nextGroups = nextGroups.filter((group) => group.groupStatus === effectiveFilter)
      }
    }

    return nextGroups
  }, [groupedResults, effectiveFilter, searchTerm])

  const visibleGroupIds = useMemo(() => filteredGroups.map((group) => group.id), [filteredGroups])

  useEffect(() => {
    if (!hasUserSelection) {
      setSelectedGroupIds(new Set(groupedResults.map((group) => group.id)))
    }
  }, [groupedResults, hasUserSelection])

  const selectedVisibleGroupIds = useMemo(
    () => filteredGroups.filter((group) => selectedGroupIds.has(group.id)).map((group) => group.id),
    [filteredGroups, selectedGroupIds],
  )

  const isAllVisibleSelected = visibleGroupIds.length > 0 && selectedVisibleGroupIds.length === visibleGroupIds.length

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const toggleGroupSelection = (groupId) => {
    setHasUserSelection(true)
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const selectAllVisibleGroups = () => {
    setHasUserSelection(true)
    setSelectedGroupIds(new Set(visibleGroupIds))
  }

  const clearVisibleSelection = () => {
    setHasUserSelection(true)
    setSelectedGroupIds(new Set())
  }

  const exportLabel = useMemo(() => {
    if (hasUserSelection) {
      return selectedVisibleGroupIds.length > 0 ? '선택된 제품 엑셀 다운로드' : '선택된 제품 없음'
    }

    if (activeFilter === 'all') {
      return isAllVisibleSelected ? '전체 엑셀 다운로드' : '현재 필터 엑셀 다운로드'
    }

    const activeFilterLabel =
      activeFilter === 'needs_attention'
        ? TOP_LEVEL_FILTERS.find((filter) => filter.key === 'needs_attention')?.children.find((child) => child.key === activeDetailFilter)?.label?.replace(/^전체$/, '수정 필요') || '수정 필요'
        : TOP_LEVEL_FILTERS.find((filter) => filter.key === activeFilter)?.label || '결과'

    return `[ ${activeFilterLabel} ] 제품 엑셀 다운로드`
  }, [activeFilter, activeDetailFilter, hasUserSelection, isAllVisibleSelected, selectedVisibleGroupIds.length])

  const exportVisibleResults = () => {
    const exportGroups = hasUserSelection ? filteredGroups.filter((group) => selectedGroupIds.has(group.id)) : filteredGroups

    if (!exportGroups.length) {
      return
    }

    const exportRows = exportGroups.flatMap((group) => {
      const groupRow = {
        체크박스: '대표P코드',
        대표P코드: group.대표P코드,
        대표상품명: group.상품명,
        ERP원산지: group.expectedOrigins.join(', ') || '없음',
        기술서원산지: group.productOrigins.join(', ') || '없음',
        상태: STATUS_META[group.groupStatus]?.label || '확인',
        메모: group.groupMessage,
      }

      const childRows = group.children.map((item) => ({
        체크박스: '하위 옵션',
        대표P코드: item.하위P코드 || '-',
        대표상품명: item.상품명 || '-',
        ERP원산지: item.expectedOrigin || '없음',
        기술서원산지: item.productOrigin || '없음',
        상태: STATUS_META[item.status]?.label || '확인',
        메모: item.message,
      }))

      return [groupRow, ...childRows]
    })

    const exportFileName = activeFilter === 'needs_attention' ? `ERP_원산지_검증_${activeDetailFilter}.xlsx` : `ERP_원산지_검증_${activeFilter}.xlsx`

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '검증결과')
    XLSX.writeFile(workbook, exportFileName)
  }

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
              {isCustomUpload ? '분석하기' : '다시 분석 돌리기'}
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

          <div className="status-tabs" role="tablist" aria-label="상태 필터">
            {TOP_LEVEL_FILTERS.map((filter) => {
              const count = filter.key === 'all' ? counts.all : filter.key === 'matched' ? counts.matched : needsAttentionCount
              const isActive = activeFilter === filter.key
              return (
                <button
                  key={filter.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={isActive ? 'status-tab active' : 'status-tab'}
                  onClick={() => {
                    setActiveFilter(filter.key)
                    if (filter.key !== 'needs_attention') setActiveDetailFilter('attention_all')
                  }}
                >
                  {filter.label}
                  <span className={filter.key === 'needs_attention' ? 'tab-count warn' : 'tab-count'}>{count}</span>
                </button>
              )
            })}
            <label className="search-box" aria-label="검색">
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="품목코드, 품목명 검색"
              />
            </label>
          </div>

          {activeFilter === 'needs_attention' && (
            <div className="sub-filters" aria-label="세부 필터">
              {TOP_LEVEL_FILTERS.find((filter) => filter.key === 'needs_attention')?.children.map((filter) => {
                const count = filter.key === 'attention_all' ? needsAttentionCount : counts[filter.key] ?? 0
                return (
                  <button
                    key={filter.key}
                    type="button"
                    className={activeDetailFilter === filter.key ? 'chip active' : 'chip'}
                    onClick={() => setActiveDetailFilter(filter.key)}
                  >
                    {filter.label}
                    <span className="chip-count">{count}</span>
                  </button>
                )
              })}
            </div>
          )}

         

          <div className="results-toolbar">
             <p className="result-caption">
              {TOP_LEVEL_FILTERS.find((f) => f.key === activeFilter)?.label} · <strong>{filteredGroups.length}건</strong>
            </p>
            <div className="toolbar-actions">
              <button
                type="button"
                className="primary-btn export-btn"
                onClick={exportVisibleResults}
                disabled={hasUserSelection && selectedVisibleGroupIds.length === 0}
              >
                {exportLabel}
              </button>
              <button
                type="button"
                className="secondary-btn compact-btn"
                onClick={isAllVisibleSelected ? clearVisibleSelection : selectAllVisibleGroups}
              >
                {isAllVisibleSelected ? '전체 선택 해제' : '전체 선택'}
              </button>

            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="checkbox-col">선택</th>
                  <th>대표P코드</th>
                  <th>상품명</th>
                  <th>ERP 원산지</th>
                  <th>기술서 원산지</th>
                  <th>상태</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="empty-state">
                      조건에 맞는 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map((group) => (
                    <Fragment key={`${group.id}`}>
                      <tr className="group-row">
                        <td className="checkbox-col">
                          <label className="row-check">
                            <input
                              type="checkbox"
                              checked={selectedGroupIds.has(group.id)}
                              onChange={() => toggleGroupSelection(group.id)}
                            />
                            <span className="checkmark" />
                          </label>
                        </td>
                        <td>
                          <div className="group-code-wrap">
                            <span>{group.대표P코드 || '-'}</span>
                            {group.children.length > 1 && (
                              <button type="button" className="toggle-btn" onClick={() => toggleGroup(group.id)}>
                                {expandedGroups[group.id] ? '닫기' : `하위 옵션 보기 (${group.children.length})`}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="product-name">{group.상품명 || '-'}</td>
                        <td>{group.expectedOrigins.join(', ') || '없음'}</td>
                        <td>{group.productOrigins.join(', ') || '없음'}</td>
                        <td>
                          <span className={`status-badge ${STATUS_META[group.groupStatus]?.className || 'muted'}`}>
                            {STATUS_META[group.groupStatus]?.label || '확인'}
                          </span>
                        </td>
                        <td className="note-cell">
                          <div className="group-message">{group.groupMessage}</div>
                        </td>
                      </tr>

                      {expandedGroups[group.id] &&
                        group.children.map((item, index) => (
                          <tr key={`${group.id}-${item.하위P코드 || 'sub'}-${index}`} className="child-row">
                            <td className="checkbox-col">
                              <span className="child-indent">↳</span>
                            </td>
                            <td>{item.하위P코드 || '-'}</td>
                            <td>{item.상품명 || '-'}</td>
                            <td>{item.expectedOrigin || '없음'}</td>
                            <td>{item.productOrigin || '없음'}</td>
                            <td>
                              <span className={`status-badge ${STATUS_META[item.status]?.className || 'muted'}`}>
                                {STATUS_META[item.status]?.label || '확인'}
                              </span>
                            </td>
                            <td className="note-cell">{item.message}</td>
                          </tr>
                        ))}
                    </Fragment>
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

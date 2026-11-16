import { useEffect, useState } from 'react'

const MAX_IMAGE_SIDE = 1000

const formatDateTime = (iso) => {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 저장 용량을 아끼기 위해 이미지를 축소해 data URL로 변환
const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })

const api = async (method, path = '', body) => {
  const res = await fetch(`/api/posts${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail ? `${res.status}: ${data.detail}${data.hasToken === false ? ' (BLOB_READ_WRITE_TOKEN 없음)' : ''}` : String(res.status))
  return data
}

function Board() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [text, setText] = useState('')
  const [images, setImages] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET')
      .then(setPosts)
      .catch((e) => setError(`글을 불러오지 못했습니다. (${e.message})`))
      .finally(() => setLoading(false))
  }, [])

  const handleImages = async (event) => {
    const files = [...event.target.files].filter((f) => f.type.startsWith('image/'))
    event.target.value = ''
    const urls = await Promise.all(files.map((f) => fileToDataUrl(f).catch(() => null)))
    setImages((prev) => [...prev, ...urls.filter(Boolean)].slice(0, 4))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitting || (!text.trim() && images.length === 0)) return
    setSubmitting(true)
    try {
      setPosts(await api('POST', '', { text, images }))
      setError('')
      setText('')
      setImages([])
    } catch (e) {
      setError(`등록에 실패했습니다. (${e.message})`)
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('이 글을 삭제할까요?')) return
    try {
      setPosts(await api('DELETE', `?id=${encodeURIComponent(id)}`))
    } catch {
      setError('삭제에 실패했습니다.')
    }
  }

  return (
    <section className="panel board">
      <div className="board-head">
        <h2>히스토리</h2>
        <p>익명으로 남기는 공간입니다. 단종 제품, 처리 이력 등 참고할 내용을 자유롭게 적어 주세요.</p>
      </div>

      <form className="board-form" onSubmit={submit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예) P100021990 은 단종 제품이니 신경 쓰지 않으셔도 됩니다."
          rows={3}
        />
        {images.length > 0 && (
          <div className="board-previews">
            {images.map((src, i) => (
              <div key={i} className="board-preview">
                <img src={src} alt="" />
                <button type="button" aria-label="이미지 제거" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="board-actions">
          <label className="secondary-btn compact-btn board-attach">
            이미지 첨부
            <input type="file" accept="image/*" multiple hidden onChange={handleImages} />
          </label>
          <button type="submit" className="primary-btn" disabled={submitting || (!text.trim() && images.length === 0)}>{submitting ? '등록 중…' : '등록'}</button>
        </div>
        {error && <p className="board-error">{error}</p>}
      </form>

      <ul className="board-list">
        {loading && <li className="board-empty">불러오는 중…</li>}
        {!loading && posts.length === 0 && <li className="board-empty">아직 등록된 글이 없습니다.</li>}
        {posts.map((post) => (
          <li key={post.id} className="board-item">
            <div className="board-meta">
              <span>익명 · {formatDateTime(post.createdAt)}</span>
              <button type="button" className="board-delete" onClick={() => remove(post.id)}>삭제</button>
            </div>
            {post.text && <p className="board-text">{post.text}</p>}
            {post.images?.length > 0 && (
              <div className="board-images">
                {post.images.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt="첨부 이미지" /></a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default Board

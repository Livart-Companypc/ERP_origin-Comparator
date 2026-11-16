import { useState } from 'react'

const STORAGE_KEY = 'erp-pcode-board-v1'
const MAX_IMAGE_SIDE = 1200

const loadPosts = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

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
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })

const persist = (posts) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts))
    return true
  } catch {
    return false
  }
}

function Board() {
  const [posts, setPosts] = useState(loadPosts)
  const [text, setText] = useState('')
  const [images, setImages] = useState([])
  const [error, setError] = useState('')

  const handleImages = async (event) => {
    const files = [...event.target.files].filter((f) => f.type.startsWith('image/'))
    event.target.value = ''
    const urls = await Promise.all(files.map((f) => fileToDataUrl(f).catch(() => null)))
    setImages((prev) => [...prev, ...urls.filter(Boolean)].slice(0, 4))
  }

  const submit = (event) => {
    event.preventDefault()
    if (!text.trim() && images.length === 0) return
    const next = [{ id: Date.now(), text: text.trim(), images, createdAt: new Date().toISOString() }, ...posts]
    if (!persist(next)) {
      setError('저장 공간이 부족합니다. 이미지를 줄이거나 오래된 글을 삭제해 주세요.')
      return
    }
    setError('')
    setPosts(next)
    setText('')
    setImages([])
  }

  const remove = (id) => {
    if (!window.confirm('이 글을 삭제할까요?')) return
    const next = posts.filter((p) => p.id !== id)
    persist(next)
    setPosts(next)
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
          <button type="submit" className="primary-btn" disabled={!text.trim() && images.length === 0}>등록</button>
        </div>
        {error && <p className="board-error">{error}</p>}
      </form>

      <ul className="board-list">
        {posts.length === 0 && <li className="board-empty">아직 등록된 글이 없습니다.</li>}
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

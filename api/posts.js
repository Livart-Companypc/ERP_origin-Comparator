/* global Buffer */
import { list, put } from '@vercel/blob'

const DB_PATH = 'board/posts.json'
const MAX_POSTS = 500

const readPosts = async () => {
  const { blobs } = await list({ prefix: DB_PATH })
  const blob = blobs.find((b) => b.pathname === DB_PATH)
  if (!blob) return []
  const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' })
  return res.ok ? res.json() : []
}

const writePosts = (posts) =>
  put(DB_PATH, JSON.stringify(posts), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  })

const uploadImage = async (dataUrl, index) => {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || '')
  if (!match) return null
  const ext = match[1].split('/')[1].replace('jpeg', 'jpg')
  const blob = await put(`board/img-${Date.now()}-${index}.${ext}`, Buffer.from(match[2], 'base64'), {
    access: 'public',
    contentType: match[1],
  })
  return blob.url
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await readPosts())
    }

    if (req.method === 'POST') {
      const text = String(req.body?.text || '').trim().slice(0, 3000)
      const rawImages = Array.isArray(req.body?.images) ? req.body.images.slice(0, 4) : []
      if (!text && rawImages.length === 0) return res.status(400).json({ error: 'empty' })

      const images = (await Promise.all(rawImages.map(uploadImage))).filter(Boolean)
      const post = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, images, createdAt: new Date().toISOString() }
      const posts = [post, ...(await readPosts())].slice(0, MAX_POSTS)
      await writePosts(posts)
      return res.status(200).json(posts)
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '')
      const posts = (await readPosts()).filter((p) => p.id !== id)
      await writePosts(posts)
      return res.status(200).json(posts)
    }

    res.setHeader('Allow', 'GET, POST, DELETE')
    return res.status(405).json({ error: 'method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'server error' })
  }
}

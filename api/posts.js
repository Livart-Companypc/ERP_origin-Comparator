/* global Buffer */
import { get, put } from '@vercel/blob'

const DB_PATH = 'board/posts.json'
const MAX_POSTS = 500

// 스토어가 public/private 어느 쪽으로 만들어졌는지 모르므로 성공하는 쪽을 찾아 기억한다.
let knownAccess = null

const withAccess = async (fn) => {
  const order = knownAccess ? [knownAccess] : ['private', 'public']
  let lastError
  for (const access of order) {
    try {
      const result = await fn(access)
      knownAccess = access
      return result
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

const readPosts = async () => {
  const result = await withAccess((access) => get(DB_PATH, { access, useCache: false }))
  if (!result || result.statusCode !== 200) return []
  return JSON.parse(await new Response(result.stream).text())
}

const writePosts = (posts) =>
  withAccess((access) =>
    put(DB_PATH, JSON.stringify(posts), {
      access,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    }),
  )

const uploadImage = async (dataUrl, index) => {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || '')
  if (!match) return null
  const ext = match[1].split('/')[1].replace('jpeg', 'jpg')
  const blob = await withAccess((access) =>
    put(`board/img-${Date.now()}-${index}.${ext}`, Buffer.from(match[2], 'base64'), {
      access,
      contentType: match[1],
    }),
  )
  return `/api/image?p=${encodeURIComponent(blob.pathname)}`
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
    return res.status(500).json({ error: 'server error', detail: String(error?.message || error).slice(0, 300) })
  }
}

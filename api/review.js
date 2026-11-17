import { get, put } from '@vercel/blob'

// 수정완료 체크 / 직접 메모를 서버(Vercel Blob)에 저장 → 브라우저·기기가 달라도 공유됨
const DB_PATH = 'review/state.json'

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

const readState = async () => {
  const result = await withAccess((access) => get(DB_PATH, { access, useCache: false }))
  if (!result || result.statusCode !== 200) return { fixed: {}, memos: {} }
  const parsed = JSON.parse(await new Response(result.stream).text())
  return { fixed: parsed.fixed || {}, memos: parsed.memos || {} }
}

const writeState = (state) =>
  withAccess((access) =>
    put(DB_PATH, JSON.stringify(state), {
      access,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    }),
  )

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await readState())
    }

    if (req.method === 'POST') {
      const id = String(req.body?.id || '').slice(0, 200)
      if (!id) return res.status(400).json({ error: 'id required' })

      const state = await readState()
      if (typeof req.body.fixed === 'boolean') {
        if (req.body.fixed) state.fixed[id] = true
        else delete state.fixed[id]
      }
      if (typeof req.body.memo === 'string') {
        const memo = req.body.memo.slice(0, 3000)
        if (memo) state.memos[id] = memo
        else delete state.memos[id]
      }
      await writeState(state)
      return res.status(200).json(state)
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'server error', detail: String(error?.message || error).slice(0, 300) })
  }
}

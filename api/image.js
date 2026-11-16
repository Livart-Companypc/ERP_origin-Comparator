import { get } from '@vercel/blob'
import { Readable } from 'node:stream'

// 이미지 프록시: 스토어가 private이어도 브라우저에서 볼 수 있게 한다.
export default async function handler(req, res) {
  const pathname = String(req.query?.p || '')
  if (!pathname.startsWith('board/img-') || pathname.includes('..')) {
    return res.status(400).end()
  }

  for (const access of ['private', 'public']) {
    try {
      const result = await get(pathname, { access })
      if (result && result.statusCode === 200) {
        res.setHeader('Content-Type', result.blob.contentType)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        return Readable.fromWeb(result.stream).pipe(res)
      }
    } catch {
      // 다른 access로 재시도
    }
  }
  return res.status(404).end()
}

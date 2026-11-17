/* global process */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 로컬 개발용: /api/origin 을 vite 서버에서 직접 처리 (사내망 인증서 때문에 TLS 검증 생략)
const originDevApi = () => ({
  name: 'origin-dev-api',
  configureServer(server) {
    server.middlewares.use('/api/origin', async (req, res) => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      const { fetchOrigins } = await import('./api/_originCore.js')
      const url = new URL(req.url, 'http://localhost')
      const codes = [...new Set((url.searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 30)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(await fetchOrigins(codes)))
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), originDevApi()],
})

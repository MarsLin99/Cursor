import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'
import { attachBoard } from './server/board.ts'

const proxy: Record<string, ProxyOptions> = {
  '/api/twse': {
    target: 'https://www.twse.com.tw',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/twse/, ''),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; TaHedgeLab/1.0; +https://localhost)',
      Accept: 'application/json,text/plain,*/*',
    },
  },
  '/api/yahoo': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
  },
  '/api/listed': {
    target: 'https://openapi.twse.com.tw',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/listed/, ''),
  },
  '/api/tpex': {
    target: 'https://www.tpex.org.tw',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/tpex/, ''),
  },
}

const host = '127.0.0.1'
const port = 4173
/** 社區網路沒有公開 IP，對外網址由 Cloudflare 隧道轉進來 */
const allowedHosts = ['.trycloudflare.com']

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'market-board',
      configureServer(server) {
        attachBoard(server.middlewares)
      },
      configurePreviewServer(server) {
        attachBoard(server.middlewares)
      },
    },
  ],
  server: { proxy, host, port, strictPort: true, allowedHosts },
  preview: { proxy, host, port, strictPort: true, allowedHosts },
})

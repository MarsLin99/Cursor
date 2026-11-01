import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

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
}

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})

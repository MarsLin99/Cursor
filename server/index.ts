import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAllIndicators } from './sources/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')

const app = express()
const PORT = Number(process.env.PORT || 4173)

app.use(cors())
app.use(express.json())

let cache: { at: number; payload: unknown } | null = null
const CACHE_MS = 15 * 60 * 1000

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

app.get('/api/indicators', async (req, res) => {
  try {
    const force = req.query.refresh === '1'
    const now = Date.now()
    if (!force && cache && now - cache.at < CACHE_MS) {
      res.json({ ...(cache.payload as object), cached: true })
      return
    }
    const payload = await fetchAllIndicators()
    cache = { at: now, payload }
    res.json({ ...payload, cached: false })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: '無法取得指標資料',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`景氣觀測 PWA 服務於 http://0.0.0.0:${PORT}`)
})

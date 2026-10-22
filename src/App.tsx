import { useEffect, useState } from 'react'
import { IndicatorPanel } from './components/IndicatorPanel'
import { StockPanel } from './components/StockPanel'
import { formatDate } from './lib/range'
import type { IndicatorsPayload } from './types'

export default function App() {
  const [data, setData] = useState<IndicatorsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(force = false) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/indicators${force ? '?refresh=1' : ''}`,
      )
      if (!res.ok) throw new Error(`伺服器錯誤 ${res.status}`)
      const json = (await res.json()) as IndicatorsPayload
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden="true" />
      <header className="hero">
        <div className="hero-inner">
          <p className="brand">景氣觀測</p>
          <h1>把關鍵景氣訊號，收成一張隨身儀表板。</h1>
          <p className="lede">
            追蹤 ISM、薩姆規則、景氣燈號、出口年增、BDI 與前一日台股，支援一年到一個月趨勢切換。可加到主畫面當 PWA 使用。
          </p>
          <div className="hero-actions">
            <button type="button" className="btn primary" onClick={() => void load(true)}>
              {loading ? '更新中…' : '立即更新'}
            </button>
            <a className="btn ghost" href="#dashboard">
              查看指標
            </a>
          </div>
          {data && (
            <p className="hero-meta">
              資料時間（台北）{formatDate(data.updatedAt)}
              {data.cached ? ' · 快取' : ' · 即時抓取'}
            </p>
          )}
        </div>
      </header>

      <main id="dashboard" className="dashboard">
        {error && <div className="banner error">載入失敗：{error}</div>}
        {loading && !data && <div className="banner">正在抓取最新公開資料…</div>}

        <StockPanel stock={data?.stock ?? null} />

        <div className="panel-grid">
          {(data?.indicators || []).map((ind, i) => (
            <IndicatorPanel key={ind.id} indicator={ind} delay={120 + i * 80} />
          ))}
        </div>
      </main>

      <footer className="site-foot">
        <p>
          僅供個人觀察，非投資建議。資料來自公開來源，發布頻率依各機構為準（月／日）。
        </p>
      </footer>
    </div>
  )
}

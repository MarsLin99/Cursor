import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeskSlots } from './DeskApp'
import { clock, fmt, signed, tone, yi } from './format'
import type { DeskReport, MacroSnapshot, QuoteRow } from './types'

type Snapshot = MacroSnapshot & {
  report: DeskReport | null
  schedule?: string[]
}

const WATCH_KEY = 'desk-watchlist-v2'

function IndexChart({ points }: { points: { time: string; value: number }[] }) {
  if (points.length < 2) {
    return (
      <div className="index-chart-slot">
        <p className="hint">指數走勢會在掃描後出現。</p>
      </div>
    )
  }
  const width = 640
  const height = 280
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const coords = points
    .map((point, i) => {
      const x = (i / (points.length - 1)) * (width - 24) + 8
      const y = 16 + ((max - point.value) / span) * (height - 36)
      return `${x},${y}`
    })
    .join(' ')
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="index-chart index-chart-slot" role="img" aria-label="加權指數">
      <polyline points={coords} />
      <text x="16" y="28">
        {fmt(max, 0)}
      </text>
      <text x="16" y={height - 12}>
        {fmt(min, 0)}
      </text>
      <text x={width - 150} y="28">
        {last.time} {fmt(last.value, 0)}
      </text>
    </svg>
  )
}

export function AnalysisPage({ slots }: { slots: DeskSlots | null }) {
  const [data, setData] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState<'scan' | 'report' | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    const res = await fetch('/api/board/snapshot')
    if (!res.ok) throw new Error('讀不到分析資料')
    setData((await res.json()) as Snapshot)
  }

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : '讀取失敗'),
    )
  }, [])

  const refresh = async () => {
    setBusy('scan')
    setError('')
    try {
      await fetch('/api/board/refresh', { method: 'POST' })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '掃描失敗')
    } finally {
      setBusy(null)
    }
  }

  const report = async () => {
    setBusy('report')
    setError('')
    try {
      const saved = localStorage.getItem(WATCH_KEY)
      const items = saved ? (JSON.parse(saved) as { symbol: string; market: 'twse' | 'tpex' }[]) : []
      const quoteRes = await fetch(
        `/api/board/quotes?items=${encodeURIComponent(items.map((item) => `${item.symbol}:${item.market}`).join(','))}`,
      )
      const quotes = quoteRes.ok ? ((await quoteRes.json()) as QuoteRow[]) : []
      const res = await fetch('/api/board/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotes }),
      })
      const body = (await res.json()) as DeskReport & { error?: string }
      if (!res.ok) throw new Error(body.error || '報告失敗')
      setData((prev) => (prev ? { ...prev, report: body } : prev))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '報告失敗')
    } finally {
      setBusy(null)
    }
  }

  const index = data?.index
  const reportView = data?.report

  return (
    <div className="analysis">
      {slots
        ? createPortal(
            <div className="title-stack">
              <p className="kicker">市場分析</p>
              <p className="asof">
                資料更新 {clock(data?.scannedAt ?? null)} · 固定掃描{' '}
                {data?.schedule?.join('、') || '08:40、14:00、15:10、21:00'}
              </p>
            </div>,
            slots.left,
          )
        : null}

      <section className="macro-grid">
        <div className="macro-side">
          <h2>前一交易日大盤</h2>
          <p className={`big ${tone(index?.change)}`}>{fmt(index?.price ?? null)}</p>
          <p className={tone(index?.change)}>
            {signed(index?.change ?? null)} {signed(index?.pct ?? null)}%
          </p>
          <ul className="inst">
            <li>
              外資 <b className={tone(data?.institutions.foreign)}>{yi(data?.institutions.foreign)}</b>
            </li>
            <li>
              投信 <b className={tone(data?.institutions.trust)}>{yi(data?.institutions.trust)}</b>
            </li>
            <li>
              自營商 <b className={tone(data?.institutions.dealer)}>{yi(data?.institutions.dealer)}</b>
            </li>
          </ul>
          <h3>原物料</h3>
          <ul className="inst">
            <li>
              黃金 <b>{fmt(data?.gold?.price ?? null)}</b>
              <span className={tone(data?.gold?.change)}>{signed(data?.gold?.pct ?? null)}%</span>
            </li>
            <li>
              布倫特原油 <b>{fmt(data?.brent?.price ?? null)}</b>
              <span className={tone(data?.brent?.change)}>{signed(data?.brent?.pct ?? null)}%</span>
            </li>
          </ul>
          <h3>尚無固定來源</h3>
          <p className="hint">{data?.blanks.join('、') || '—'}</p>
        </div>
        <div className="macro-chart">
          <h2>加權指數</h2>
          <p className="hint">近半年收盤。全市場擔保維持率目前沒有可穩定讀取的官方序列，所以這張圖只畫加權。</p>
          <IndexChart points={data?.indexHistory ?? []} />
        </div>
      </section>

      <section className="report">
        <header>
          <div>
            <h2>操作建議報告</h2>
            <p className="hint">
              {reportView
                ? `${reportView.engine === 'grok' ? 'Grok 4.7' : '規則引擎'} ${clock(reportView.generatedAt)}`
                : '尚未產生'}
            </p>
          </div>
          <div className="report-actions">
            <button type="button" onClick={() => void refresh()} disabled={busy != null}>
              {busy === 'scan' ? '掃描中…' : '重新抓資料'}
            </button>
            <button type="button" className="solid" onClick={() => void report()} disabled={busy != null}>
              {busy === 'report' ? '分析中…' : '產生／更新報告'}
            </button>
          </div>
        </header>
        {error ? <p className="notice">{error}</p> : null}
        {reportView?.note ? <p className="notice">{reportView.note}</p> : null}
        {reportView ? (
          <>
            <p className="stance">
              立場 <b>{reportView.stance}</b> {reportView.summary}
            </p>
            <div className="stock-cards">
              {reportView.stocks.map((stock) => (
                <article key={stock.symbol}>
                  <h3>
                    {stock.symbol} {stock.name}
                  </h3>
                  <p>{stock.action}</p>
                  <small>{stock.detail}</small>
                </article>
              ))}
            </div>
            <h3>衛星</h3>
            <ul>
              {reportView.satellite.map((stock) => (
                <li key={stock.symbol}>
                  {stock.symbol} {stock.name}：{stock.detail}
                </li>
              ))}
            </ul>
            <h3>市場上勝率相對高的標的</h3>
            <p className="hint">近 120 個交易日，收盤後持有到下一交易日上漲的比率。</p>
            <ul>
              {reportView.highWin.map((pick) => (
                <li key={pick.symbol}>
                  {pick.symbol} {pick.name} {(pick.winRate * 100).toFixed(1)}%（{pick.samples} 日）
                </li>
              ))}
            </ul>
            <h3>市場總覽</h3>
            <ul>
              {reportView.marketBullets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <h3>建議持股架構</h3>
            <ul>
              {reportView.structure.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="hint">以上是研究筆記，不是投資建議，下單前請自行確認。</p>
          </>
        ) : (
          <p className="hint">按產生／更新報告後，會用報價列表和已掃描的總經寫一份建議。</p>
        )}
      </section>
    </div>
  )
}

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DeskSlots } from './DeskApp'
import type { InsightBundle, InsightCard, InsightMetric, InsightReport, OverlayPoint, RetailPoint } from './types'

type InsightPayload = InsightBundle & {
  fromCache?: boolean
  report: InsightReport | null
  llm?: { configured: boolean }
}

const WATCH_KEY = 'desk-watchlist-v2'
const REPORT_KEY = 'desk-insight-report-v1'
const KEEP_COLOR = '#b8893d'

function watchCodes() {
  try {
    const saved = localStorage.getItem(WATCH_KEY)
    const items = saved ? (JSON.parse(saved) as { symbol: string }[]) : []
    return items.map((item) => item.symbol).filter(Boolean)
  } catch {
    return [] as string[]
  }
}

function sameCodes(a: string[] = [], b: string[] = []) {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((code, i) => code === right[i])
}

function readLocalReport(codes: string[]) {
  if (!codes.length) return null
  try {
    const saved = localStorage.getItem(REPORT_KEY)
    if (!saved) return null
    const report = JSON.parse(saved) as InsightReport
    const symbols = report.symbols ?? report.stockIdeas.map((idea) => idea.code)
    return sameCodes(symbols, codes) ? report : null
  } catch {
    return null
  }
}

function writeLocalReport(report: InsightReport | null) {
  if (!report) {
    localStorage.removeItem(REPORT_KEY)
    return
  }
  localStorage.setItem(REPORT_KEY, JSON.stringify(report))
}
const BALANCE_COLOR = '#3f6f9f'
const TAIEX_COLOR = '#1f7a6c'
const LONG_COLOR = '#c45c4a'
const SHORT_COLOR = '#1f7a6c'

function group(value: number, digits = 0) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function plus(value: number, digits = 0) {
  const text = group(value, digits)
  return value > 0 ? `+${text}` : text
}

function stamp(iso: string | undefined) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Status({ item }: { item: InsightMetric }) {
  if (!item.status) return null
  if (item.lamp) {
    return (
      <span className={`lamp lamp-${item.tone}`}>
        <i />
        {item.status}
      </span>
    )
  }
  return <span className={`pill ${item.tone}`}>{item.status}</span>
}

function MarketCard({ card }: { card: InsightCard }) {
  const bars = card.derivatives?.bars ?? []
  const peak = Math.max(1, ...bars.map((bar) => Math.abs(bar.value)))
  return (
    <article className="macro-card market">
      <div className="market-grid">
        <h3>{card.title}</h3>
        <p className="market-period">{card.period}</p>
        <p className={`macro-index ${card.tone}`}>
          {card.value}
          <span className={card.detailTone}>{card.detail}</span>
        </p>
        <div className="macro-parties">
          {card.institutions?.items.map((party) => (
            <p key={party.name} className={`macro-party ${party.tone}`}>
              <span className="macro-party-name">{party.name}</span>
              <span className="macro-party-value">{party.text}</span>
            </p>
          ))}
          {card.institutions?.dateLabel ? <p className="macro-note">法人 {card.institutions.dateLabel}</p> : null}
        </div>
        {bars.length ? (
          <div className="fut-bars">
            <p className="fut-bars-title">
              {card.derivatives?.title}（{card.derivatives?.unit}）
            </p>
            {bars.map((bar) => (
              <div key={bar.label} className="fut-bar-row" title={`未平倉淨額 ${group(bar.level)} 口`}>
                <span className="fut-bar-date">{bar.label}</span>
                <span className="fut-bar-track">
                  <span className={`fut-bar ${bar.tone}`} style={{ width: `${(Math.abs(bar.value) / peak) * 100}%` }} />
                </span>
                <span className={`fut-bar-val ${bar.tone}`}>{plus(bar.value)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {card.note ? <p className="macro-note">{card.note}</p> : null}
    </article>
  )
}

function ListCard({ card }: { card: InsightCard }) {
  const items = card.items ?? []
  return (
    <article className={`macro-card list${items.length > 6 ? ' dense' : ''}`}>
      <div className="metric-stack">
        {items.map((item) => {
          const tip = item.href
            ? `${item.source} · 開啟資料來源`
            : item.note
              ? `${item.source}：${item.note}`
              : item.source
          const body = (
            <>
              <div className="metric-top">
                <span className="metric-name">{item.title}</span>
                <Status item={item} />
                <span className="metric-date">{item.period}</span>
              </div>
              <div className="metric-bottom">
                <span className="metric-value">{item.value}</span>
                {item.detail ? <span className={`metric-delta ${item.detailTone}`}>{item.detail}</span> : null}
              </div>
            </>
          )
          return item.href ? (
            <a
              key={item.id}
              className="metric-row has-source"
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              title={tip}
            >
              {body}
            </a>
          ) : (
            <div key={item.id} className="metric-row" title={tip}>
              {body}
            </div>
          )
        })}
      </div>
    </article>
  )
}

// 分析頁放大 32%（1.2 × 1.1）：邊距、線寬、點半徑一起乘 1.32（字級在 CSS 已放大）
const SCALE = 1.32
const PAD = { top: 28 * SCALE, right: 62 * SCALE, bottom: 40 * SCALE, left: 54 * SCALE }

function OverlayChart({ points }: { points: OverlayPoint[] }) {
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 640, h: 340 })
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const node = frame.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize({ w: Math.max(320, Math.round(rect.width)), h: Math.max(240, Math.round(rect.height)) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (points.length < 2) {
    return (
      <div ref={frame} className="chart-frame">
        <p className="hint">維持率資料讀取中…</p>
      </div>
    )
  }
  const { w, h } = size
  const plotW = w - PAD.left - PAD.right
  const plotH = h - PAD.top - PAD.bottom
  const keeps = points.map((point) => point.keepRate)
  const balances = points.flatMap((point) => (point.balance == null ? [] : [point.balance]))
  const taiex = points.flatMap((point) => (point.taiex == null ? [] : [point.taiex]))
  const range = (values: number[]) => {
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo || Math.abs(hi) * 0.01 || 1) * 0.08
    return [lo - pad, hi + pad] as const
  }
  const [kLo, kHi] = range(keeps)
  const [bLo, bHi] = balances.length ? range(balances) : [0, 1]
  const [tLo, tHi] = taiex.length ? range(taiex) : [0, 1]
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW
  const yK = (v: number) => PAD.top + ((kHi - v) / (kHi - kLo)) * plotH
  const yB = (v: number) => PAD.top + ((bHi - v) / (bHi - bLo)) * plotH
  const yT = (v: number) => PAD.top + ((tHi - v) / (tHi - tLo)) * plotH
  const keepPath = points.map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yK(point.keepRate).toFixed(1)}`).join('')
  let balancePath = ''
  points.forEach((point, i) => {
    if (point.balance == null) return
    balancePath += `${balancePath ? 'L' : 'M'}${x(i).toFixed(1)},${yB(point.balance).toFixed(1)}`
  })
  let taiexPath = ''
  points.forEach((point, i) => {
    if (point.taiex == null) return
    taiexPath += `${taiexPath ? 'L' : 'M'}${x(i).toFixed(1)},${yT(point.taiex).toFixed(1)}`
  })
  const grid = [0, 1, 2, 3, 4]
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
  const last = points[points.length - 1]
  const lastTaiexIndex = points.map((point) => point.taiex).lastIndexOf(taiex[taiex.length - 1])

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * w
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1))
    setHover(i >= 0 && i < points.length ? i : null)
  }
  const tip = hover != null ? points[hover] : null

  return (
    <div ref={frame} className="chart-frame">
      <svg
        className="overlay-chart"
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label="大盤融資維持率、融資餘額與加權指數"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {grid.map((g) => {
          const y = PAD.top + (g / 4) * plotH
          return (
            <g key={g}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} className="ov-grid" />
              <text x={PAD.left - 6 * SCALE} y={y + 4 * SCALE} textAnchor="end" className="ov-axis">
                {(kHi - (g / 4) * (kHi - kLo)).toFixed(1)}
              </text>
              {taiex.length ? (
                <text x={w - PAD.right + 6 * SCALE} y={y + 4 * SCALE} className="ov-axis">
                  {group(tHi - (g / 4) * (tHi - tLo))}
                </text>
              ) : null}
            </g>
          )
        })}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={h - PAD.bottom + 18 * SCALE} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="ov-axis">
            {points[i].date.slice(5)}
          </text>
        ))}
        {taiexPath ? <path d={taiexPath} fill="none" stroke={TAIEX_COLOR} strokeWidth={2.4 * SCALE} strokeDasharray={`${7 * SCALE} ${5 * SCALE}`} /> : null}
        {balancePath ? <path d={balancePath} fill="none" stroke={BALANCE_COLOR} strokeWidth={2.4 * SCALE} strokeLinejoin="round" /> : null}
        <path d={keepPath} fill="none" stroke={KEEP_COLOR} strokeWidth={2.6 * SCALE} strokeLinejoin="round" />
        <text x={x(points.length - 1) - 4 * SCALE} y={yK(last.keepRate) - 8 * SCALE} textAnchor="end" className="ov-last" fill={KEEP_COLOR}>
          {last.keepRate.toFixed(2)}%
        </text>
        {taiex.length && lastTaiexIndex >= 0 ? (
          <text x={x(lastTaiexIndex) - 4 * SCALE} y={yT(taiex[taiex.length - 1]) + 16 * SCALE} textAnchor="end" className="ov-last" fill={TAIEX_COLOR}>
            {group(taiex[taiex.length - 1])}
          </text>
        ) : null}
        {tip && hover != null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={h - PAD.bottom} className="ov-hover" />
            <circle cx={x(hover)} cy={yK(tip.keepRate)} r={3.5 * SCALE} fill={KEEP_COLOR} />
            {tip.balance != null ? <circle cx={x(hover)} cy={yB(tip.balance)} r={3.5 * SCALE} fill={BALANCE_COLOR} /> : null}
            {tip.taiex != null ? <circle cx={x(hover)} cy={yT(tip.taiex)} r={3.5 * SCALE} fill={TAIEX_COLOR} /> : null}
          </g>
        ) : null}
      </svg>
      {tip && hover != null ? (
        <div className="ov-tip" style={{ left: `${(x(hover) / w) * 100}%` }}>
          <b>{tip.date}</b>
          <span style={{ color: KEEP_COLOR }}>融資維持率 {tip.keepRate.toFixed(2)}%</span>
          <span style={{ color: BALANCE_COLOR }}>融資餘額 {tip.balance != null ? `${group(tip.balance, 0)}億` : '—'}</span>
          <span style={{ color: TAIEX_COLOR }}>加權 {tip.taiex != null ? group(tip.taiex, 2) : '—'}</span>
        </div>
      ) : null}
    </div>
  )
}

function RetailChart({ points }: { points: RetailPoint[] }) {
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 980, h: 280 })
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const node = frame.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize({ w: Math.max(320, Math.round(rect.width)), h: Math.max(180, Math.round(rect.height)) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (points.length < 2) {
    return (
      <div ref={frame} className="chart-frame">
        <p className="hint">微台散戶多空比讀取中…</p>
      </div>
    )
  }
  const { w, h } = size
  const plotW = w - PAD.left - PAD.right
  const plotH = h - PAD.top - PAD.bottom
  const values = points.map((point) => point.ratio)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo || 1) * 0.12
  const yLo = lo - pad
  const yHi = hi + pad
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW
  const y = (v: number) => PAD.top + ((yHi - v) / (yHi - yLo)) * plotH
  const runs: { color: string; d: string }[] = []
  points.forEach((point, i) => {
    const color = point.ratio >= 0 ? LONG_COLOR : SHORT_COLOR
    const cmd = `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.ratio).toFixed(1)}`
    const prev = runs[runs.length - 1]
    if (i > 0 && prev && prev.color === color) prev.d += cmd
    else runs.push({ color, d: i ? `${`M${x(i - 1).toFixed(1)},${y(points[i - 1].ratio).toFixed(1)}`}${cmd}` : cmd })
  })
  const zero = yLo < 0 && yHi > 0 ? y(0) : null
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * w
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1))
    setHover(i >= 0 && i < points.length ? i : null)
  }
  const tip = hover != null ? points[hover] : null

  return (
    <div ref={frame} className="chart-frame">
      <svg className="overlay-chart" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="微台散戶多空比" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3].map((g) => {
          const gy = PAD.top + (g / 3) * plotH
          return (
            <g key={g}>
              <line x1={PAD.left} x2={w - PAD.right} y1={gy} y2={gy} className="ov-grid" />
              <text x={PAD.left - 6 * SCALE} y={gy + 4 * SCALE} textAnchor="end" className="ov-axis">
                {(yHi - (g / 3) * (yHi - yLo)).toFixed(0)}%
              </text>
            </g>
          )
        })}
        {zero != null ? <line x1={PAD.left} x2={w - PAD.right} y1={zero} y2={zero} stroke="rgba(15,61,62,0.28)" strokeWidth={1.2} /> : null}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={h - PAD.bottom + 18 * SCALE} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="ov-axis">
            {points[i].date.slice(5)}
          </text>
        ))}
        {runs.map((run, i) => (
          <path key={i} d={run.d} fill="none" stroke={run.color} strokeWidth={2.4 * SCALE} strokeLinejoin="round" />
        ))}
        {tip && hover != null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={h - PAD.bottom} className="ov-hover" />
            <circle cx={x(hover)} cy={y(tip.ratio)} r={3.5 * SCALE} fill={tip.ratio >= 0 ? LONG_COLOR : SHORT_COLOR} />
          </g>
        ) : null}
      </svg>
      {tip && hover != null ? (
        <div className="ov-tip" style={{ left: `${(x(hover) / w) * 100}%` }}>
          <b>{tip.date}</b>
          <span style={{ color: tip.ratio >= 0 ? LONG_COLOR : SHORT_COLOR }}>{plus(tip.ratio, 1)}%</span>
        </div>
      ) : null}
    </div>
  )
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    const items = list
    list = []
    blocks.push(
      <ul key={`ul${blocks.length}`}>
        {items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    )
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^\s*[-*] /.test(line)) {
      list.push(line.replace(/^\s*[-*] /, ''))
      continue
    }
    flush()
    if (!line.trim()) continue
    const heading = line.match(/^(#{1,3}) (.*)$/)
    if (heading) {
      const level = heading[1].length
      const body = inline(heading[2])
      blocks.push(level === 1 ? <h2 key={blocks.length}>{body}</h2> : level === 2 ? <h3 key={blocks.length}>{body}</h3> : <h4 key={blocks.length}>{body}</h4>)
    } else {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    }
  }
  flush()
  return <div className="report-body">{blocks}</div>
}

export function AnalysisPage({ slots }: { slots: DeskSlots | null }) {
  const [data, setData] = useState<InsightPayload | null>(null)
  const [busy, setBusy] = useState<'scan' | 'report' | null>(null)
  const [error, setError] = useState('')

  const load = async (force = false) => {
    const res = await fetch(`/api/board/insight${force ? '?force=1' : ''}`)
    if (!res.ok) throw new Error('讀不到分析資料')
    const body = (await res.json()) as InsightPayload
    const codes = watchCodes()
    setData({ ...body, report: readLocalReport(codes) })
  }

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '讀取失敗'))
    // 只重讀伺服器已經排程抓好的快取，不再定時逼來源重抓
    const timer = window.setInterval(() => void load().catch(() => null), 15 * 60_000)
    const onStorage = (event: StorageEvent) => {
      if (event.key === WATCH_KEY || event.key === REPORT_KEY) {
        setData((prev) => (prev ? { ...prev, report: readLocalReport(watchCodes()) } : prev))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const refresh = async () => {
    setBusy('scan')
    setError('')
    try {
      await load(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新抓資料失敗')
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
      if (!items.length) {
        writeLocalReport(null)
        setData((prev) => (prev ? { ...prev, report: null } : prev))
        setError('報價列表是空的，先到看盤分頁加入持股再產生報告。')
        return
      }
      const res = await fetch('/api/board/insight/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((item) => `${item.symbol}:${item.market}`).join(','), preferLlm: true }),
      })
      const body = (await res.json()) as InsightReport & { error?: string }
      if (!res.ok) throw new Error(body.error || '報告失敗')
      const stamped = { ...body, symbols: body.symbols ?? items.map((item) => item.symbol) }
      writeLocalReport(stamped)
      setData((prev) => (prev ? { ...prev, report: stamped } : prev))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '報告失敗')
    } finally {
      setBusy(null)
    }
  }

  const cards = data?.cards ?? []
  const overlay = data?.overlay ?? []
  const retail = data?.retail
  const latest = data?.margin.latest
  const keepDelta = overlay.length >= 2 ? overlay[overlay.length - 1].keepRate - overlay[overlay.length - 2].keepRate : null
  const view = data?.report
  const engine = view ? (view.engine === 'grok' ? `AI（${view.model ?? 'Grok'}）` : '規則引擎') : ''
  const gaps = (data?.errors ?? []).map((line) => line.split('：')[0])

  return (
    <div className="analysis insight">
      {slots
        ? createPortal(
            <div className="title-stack">
              <p className="kicker">市場分析</p>
              <p className="asof">
                資料更新 {data?.updatedAt?.slice(5, 16) ?? '—'}
                {gaps.length ? ` · 暫缺：${gaps.join('、')}` : ''}
              </p>
            </div>,
            slots.left,
          )
        : null}

      <section className="insight-top-grid">
        <div className="insight-left">
          {cards.length ? (
            cards.map((card) => (card.kind === 'market' ? <MarketCard key={card.id} card={card} /> : <ListCard key={card.id} card={card} />))
          ) : (
            <article className="macro-card">
              <p className="hint">{error || '總經資料讀取中…第一次大約要 10 秒。'}</p>
            </article>
          )}
        </div>
        <aside className="insight-panel margin-side">
          <div className="insight-head">
            <div>
              <h2>大盤融資維持率</h2>
              <p className="hint">
                {data?.margin.error
                  ? data.margin.error
                  : `${data?.margin.source ?? '證交所'} · 近六個月 · 平日 21:30 後更新`}
              </p>
            </div>
            <div className="margin-snapshot">
              <p className="margin-keep">{latest?.keepRate != null ? `${latest.keepRate.toFixed(2)}%` : '—'}</p>
              <p className="hint">
                {latest?.balance != null ? `融資餘額 ${group(latest.balance, 0)} 億 · ` : ''}
                {latest?.date || '—'}
                {keepDelta != null ? ` · 較前日 ${plus(keepDelta, 2)} pt` : ''}
              </p>
            </div>
          </div>
          <OverlayChart points={overlay} />
          <div className="chart-legend">
            <span className="leg">
              <i style={{ background: KEEP_COLOR }} />
              大盤融資維持率 %（左軸）
            </span>
            <span className="leg">
              <i style={{ background: BALANCE_COLOR }} />
              融資餘額（億元）
            </span>
            <span className="leg">
              <i className="dash" style={{ borderColor: TAIEX_COLOR }} />
              加權指數（右軸・虛線）
            </span>
          </div>
        </aside>
      </section>

      <section className="insight-panel retail-panel">
        <div className="insight-head">
          <div>
            <h2>微台散戶多空比</h2>
            <p className="hint">
              {retail?.error
                ? retail.error
                : '期交所 · 全市場未平倉扣掉三大法人 · 平日 16:30 後更新'}
            </p>
          </div>
          <div className="margin-snapshot">
            <p className="margin-keep" style={{ color: (retail?.latest ?? 0) >= 0 ? LONG_COLOR : SHORT_COLOR }}>
              {retail?.latest != null ? `${plus(retail.latest, 1)}%` : '—'}
            </p>
            <p className="hint">{retail?.date || '—'} · 正值偏多、負值偏空</p>
          </div>
        </div>
        <RetailChart points={retail?.points ?? []} />
      </section>

      <section className="insight-panel report-panel">
        <div className="insight-head">
          <div>
            <h2>操作建議報告</h2>
            <p className="hint">
              {view
                ? `${engine} · ${stamp(view.generatedAt)}`
                : data?.llm?.configured
                  ? '尚未產生 · Grok 已設定'
                  : '尚未產生 · 未設定 Grok 金鑰時使用規則引擎'}
            </p>
          </div>
          <div className="report-actions">
            <button type="button" onClick={() => void refresh()} disabled={busy != null}>
              {busy === 'scan' ? '抓取中…' : '重新抓資料'}
            </button>
            <button type="button" className="solid" onClick={() => void report()} disabled={busy != null}>
              {busy === 'report' ? '分析中…' : '產生／更新報告'}
            </button>
          </div>
        </div>
        {error && cards.length ? <p className="notice">{error}</p> : null}
        {view?.note ? <p className="notice">{view.note}</p> : null}
        {view ? (
          <>
            <div className="report-cards">
              <p className="stance-banner">
                <strong>{view.stance}</strong>
                <span>{view.marketSummary}</span>
              </p>
              {view.stockIdeas.length ? (
                <div className="idea-grid">
                  {view.stockIdeas.map((idea) => (
                    <article key={idea.code} className="idea-card">
                      <h3>
                        {idea.code} {idea.name}
                        <span className={idea.changePercent == null ? '' : idea.changePercent > 0 ? 'up' : idea.changePercent < 0 ? 'down' : ''}>
                          {idea.price != null ? group(idea.price, 2) : ''}{' '}
                          {idea.changePercent != null ? `${plus(idea.changePercent, 2)}%` : ''}
                        </span>
                      </h3>
                      <p className="idea-action">{idea.action}</p>
                      <p>{idea.reason}</p>
                      <small className="idea-src">{idea.source === 'taishin' ? '台新即時' : '證交所報價'}</small>
                    </article>
                  ))}
                </div>
              ) : null}
              {view.holdings.length ? (
                <div className="hold-grid">
                  {view.holdings.map((hold) => (
                    <article key={`${hold.bucket}${hold.idea}`} className="hold-card">
                      <h3>{hold.bucket}</h3>
                      <p>{hold.idea}</p>
                      <small>{hold.note}</small>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
            <Markdown text={view.markdown} />
          </>
        ) : (
          <p className="hint">
            {watchCodes().length
              ? '按「產生／更新報告」後，會用本機報價列表（台新即時價與買賣力優先）和上方總經寫一份建議。'
              : '本機報價列表是空的。到看盤分頁加入持股後，再按「產生／更新報告」。'}
          </p>
        )}
      </section>
    </div>
  )
}
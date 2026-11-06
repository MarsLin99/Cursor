import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveStockQuery, searchStocks, type StockHit } from '../lib/marketData'
import type { DeskSlots } from './DeskApp'
import { fmt, signed, tone } from './format'
import type { MacroSnapshot, QuoteRow, SparkBook, SparkPoint, TickerItem } from './types'

type Item = {
  symbol: string
  name: string
  market: 'twse' | 'tpex'
  chart: boolean
}

const STORAGE_KEY = 'desk-watchlist-v2'
/** 每台電腦／瀏覽器各自存在 localStorage；新開的從空列表開始，清空後也保持空的 */
function loadItems(): Item[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Item[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const SESSION_START = 9 * 60
const SESSION_END = 13 * 60 + 30
const CHART_H = 320
const PAD = { l: 72, r: 12, t: 8, b: 18 }
const AXIS_MARKS = [9 * 60, 10 * 60, 11 * 60, 12 * 60, 13 * 60, SESSION_END]

function priceBand(book?: SparkBook) {
  const prev = book?.prev
  const up = book?.limitUp
  const down = book?.limitDown
  if (up != null && down != null && prev != null && prev > 0) {
    const high = up / prev
    const low = down / prev
    if (high >= 1.02 && high <= 1.35 && low >= 0.65 && low <= 0.98) return { up, down }
  }
  const anchor = prev ?? book?.open ?? book?.price
  if (anchor == null || anchor <= 0) return null
  // 後端已鎖定昨收與漲跌停；這裡只是還沒拿到資料時的暫時框
  return { up: anchor * 1.1, down: anchor * 0.9 }
}

function minuteOf(stamp: string) {
  const [hour, minute, second] = stamp.split(':').map(Number)
  return hour * 60 + minute + (second || 0) / 60
}

/** 價格去掉多餘的 0：2485、30.4、7.71 */
function formatPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function signedPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : ''}${formatPrice(value)}`
}

function signedLots(value: number) {
  const n = Math.round(value)
  return `${n > 0 ? '+' : ''}${n.toLocaleString('zh-TW')}`
}

function clockOf(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

type FlowRow = { minute: number; out: number | null; inn: number | null; net: number; cum: number; est: boolean }

/** 每分鐘淨張數（外盤−內盤）與累積買賣力 */
function flowRows(book?: SparkBook): FlowRow[] {
  if (book?.flow?.length) {
    let running = 0
    return book.flow.map((row) => {
      const net = row.net ?? (row.out ?? 0) - (row.inn ?? 0)
      running = row.cum ?? running + net
      return { minute: Math.floor(minuteOf(row.t)), out: row.out, inn: row.inn, net, cum: running, est: row.src === 'est' }
    })
  }
  // 舊格式只有累積序列：每分鐘取最後一筆
  const byMinute = new Map<number, number>()
  for (const point of book?.force ?? []) byMinute.set(Math.floor(minuteOf(point.t)), point.d)
  let prevD = 0
  return [...byMinute.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, d]) => {
      const net = d - prevD
      prevD = d
      return { minute, out: null, inn: null, net, cum: d, est: false }
    })
}

/** 超過 2 分鐘沒有成交就斷線，不用斜線硬接 */
// 後端已把沒成交的分鐘補成上一筆價，只有真的斷訊超過 5 分鐘才斷線
function segmentsOf(points: SparkPoint[], maxGapSec = 300) {
  const out: SparkPoint[][] = []
  let current: SparkPoint[] = []
  let lastSec = -Infinity
  for (const point of points) {
    const sec = minuteOf(point.t) * 60
    if (current.length && sec - lastSec > maxGapSec) {
      out.push(current)
      current = []
    }
    current.push(point)
    lastSec = sec
  }
  if (current.length) out.push(current)
  return out
}

function Spark({
  item,
  quote,
  book,
}: {
  item: Item
  quote?: QuoteRow
  book?: SparkBook
}) {
  // 依卡片實際寬度畫圖，避免 SVG 等比縮放後兩側留白
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(320)
  const [hoverX, setHoverX] = useState<number | null>(null)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const height = CHART_H
  const plotW = Math.max(40, width - PAD.l - PAD.r)
  const volH = Math.max(24, Math.round((height - PAD.t - PAD.b) * 0.18))
  const priceTop = PAD.t
  const priceBottom = height - PAD.b - volH - 6
  const volTop = priceBottom + 8
  const mid = volTop + volH / 2
  const xOfMinute = (minute: number) =>
    PAD.l + ((Math.min(SESSION_END, Math.max(SESSION_START, minute)) - SESSION_START) / (SESSION_END - SESSION_START)) * plotW
  const xOf = (stamp: string) => xOfMinute(minuteOf(stamp))

  const points = book?.points ?? []
  const band = priceBand(book)
  // Y 軸以平盤（昨收，漲跌停就是由它 ±10% 算出）為正中央，上下對稱到漲停／跌停，整天固定；
  // 價格超出（無漲跌幅限制的標的）就壓在邊上，不再隨走勢縮放
  const firstPrice = points[0]?.p ?? null
  const center =
    book?.prev ?? quote?.prev ?? (band ? (band.up + band.down) / 2 : null) ?? book?.open ?? quote?.open ?? firstPrice
  const half =
    center != null && center > 0
      ? band
        ? Math.max(band.up - center, center - band.down, center * 0.001)
        : center * 0.1
      : null
  const top = center != null && half != null ? center + half : null
  const bottom = center != null && half != null ? center - half : null
  const ready = top != null && bottom != null && top > bottom
  const yOf = (value: number) =>
    priceTop + ((top! - Math.min(top!, Math.max(bottom!, value))) / (top! - bottom!)) * (priceBottom - priceTop)

  const price = book?.price ?? quote?.price ?? null
  const prev = book?.prev ?? quote?.prev ?? null
  const change = price != null && prev != null ? price - prev : (quote?.change ?? null)
  const pct = change != null && prev ? (change / prev) * 100 : (quote?.pct ?? null)
  const last = points.at(-1)
  const rising = last ? (prev != null ? last.p >= prev : last.p >= points[0].p) : (change ?? 0) >= 0
  const lineTone = rising ? 'up' : 'down'
  const segments = ready ? segmentsOf(points) : []
  const pathOf = (segment: SparkPoint[]) =>
    segment.map((point, i) => `${i ? 'L' : 'M'}${xOf(point.t).toFixed(1)},${yOf(point.p).toFixed(1)}`).join('')
  const areaOf = (segment: SparkPoint[]) =>
    `${pathOf(segment)}L${xOf(segment[segment.length - 1].t).toFixed(1)},${priceBottom}L${xOf(segment[0].t).toFixed(1)},${priceBottom}Z`

  // 買賣力：每一條＝那一分鐘的（外盤−內盤）張數差，正的往上紅、負的往下綠，依當天單分鐘最大絕對值縮放
  const rows = flowRows(book)
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.cum)))
  const slot = plotW / (SESSION_END - SESSION_START)
  const barW = Math.max(slot * 0.85, 0.8)
  const gradId = `spark-fill-${item.symbol}`
  const todayTpe = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
  const staleDate = book?.forceDate && book.forceDate !== todayTpe ? book.forceDate.slice(5).replace('-', '/') : null

  const markers = (
    [
      { price: band?.up ?? null, label: '漲停', cls: 'up' },
      { price: center, label: '平盤', cls: 'open' },
      { price: band?.down ?? null, label: '跌停', cls: 'down' },
    ] as { price: number | null; label: string; cls: string }[]
  ).filter((mark): mark is { price: number; label: string; cls: string } => ready && mark.price != null && Number.isFinite(mark.price))

  let hover: {
    x: number
    y: number
    t: string
    p: number
    out: number | null
    inn: number | null
    net: number | null
    cum: number | null
  } | null = null
  if (hoverX != null && ready && points.length && hoverX >= PAD.l && hoverX <= width - PAD.r) {
    let best = points[0]
    let bestD = Infinity
    for (const point of points) {
      const d = Math.abs(xOf(point.t) - hoverX)
      if (d < bestD) {
        bestD = d
        best = point
      }
    }
    const minute = Math.floor(minuteOf(best.t))
    let upTo: FlowRow | undefined
    let same: FlowRow | undefined
    for (const row of rows) {
      if (row.minute <= minute) upTo = row
      if (row.minute === minute) same = row
    }
    hover = {
      x: xOf(best.t),
      y: yOf(best.p),
      t: best.t.slice(0, 5),
      p: best.p,
      out: same?.out ?? null,
      inn: same?.inn ?? null,
      net: same?.net ?? null,
      cum: upTo?.cum ?? null,
    }
  }
  const flip = hover != null && hover.x > width * 0.58

  return (
    <article className="spark-card">
      <header>
        <div className="spark-title">
          <strong>
            {item.symbol} {book?.name || item.name}
          </strong>
          <span className="market-tag">{item.market === 'tpex' ? '上櫃' : '上市'}</span>
        </div>
        <div className={`spark-price ${tone(change)}`}>
          <b>{formatPrice(price)}</b>
          <span>
            {signedPrice(change)}  {pct == null ? '—' : `${signed(pct, 2)}%`}
          </span>
        </div>
      </header>
      <div className="spark-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${item.name} 當日走勢`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setHoverX(((event.clientX - rect.left) / Math.max(1, rect.width)) * width)
          }}
          onPointerLeave={() => setHoverX(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1={priceTop} x2="0" y2={priceBottom} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={rising ? '#c45c4a' : '#1f7a6c'} stopOpacity={0.22} />
              <stop offset="1" stopColor="#fffcf5" stopOpacity={0} />
            </linearGradient>
          </defs>
          {markers.map((mark) => {
            const y = yOf(mark.price)
            return (
              <g key={mark.label}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} className={`mark ${mark.cls}`} />
                <text
                  x={PAD.l - 6}
                  y={Math.min(priceBottom - 6, Math.max(priceTop + 6, y))}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className={`mark-label ${mark.cls}`}
                >
                  {mark.label} {formatPrice(mark.price)}
                </text>
              </g>
            )
          })}
          {AXIS_MARKS.map((minute) => (
            <text key={minute} x={xOfMinute(minute)} y={height - 6} textAnchor="middle" className="axis">
              {clockOf(minute)}
            </text>
          ))}
          {staleDate ? (
            <text x={PAD.l + 4} y={priceTop + 10} className="stale">
              {staleDate} 資料
            </text>
          ) : null}

          <line x1={PAD.l} x2={width - PAD.r} y1={mid} y2={mid} className="zero" />
          {rows.map((row) => {
            // 每一條＝開盤到這一分鐘的累積（外盤−內盤）張數（同台新 App 的內外盤差）
            const h = (Math.abs(row.cum) / maxAbs) * (volH / 2)
            const x = xOfMinute(row.minute) - slot / 2
            return (
              <rect
                key={row.minute}
                x={x}
                y={row.cum >= 0 ? mid - h : mid}
                width={barW}
                height={Math.max(h, 0.5)}
                className={row.cum >= 0 ? 'force-bar up' : 'force-bar down'}
              />
            )
          })}
          <text x={PAD.l - 8} y={mid - 9} textAnchor="end" dominantBaseline="middle" className="side-label up">
            買
          </text>
          <text x={PAD.l - 8} y={mid + 9} textAnchor="end" dominantBaseline="middle" className="side-label down">
            賣
          </text>

          {segments.map((segment) => (
            <g key={segment[0].t}>
              <path d={areaOf(segment)} fill={`url(#${gradId})`} stroke="none" />
              <path d={pathOf(segment)} className={`line ${lineTone}`} />
            </g>
          ))}
          {ready && last ? <circle cx={xOf(last.t)} cy={yOf(last.p)} r="3.2" className={`dot ${lineTone}`} /> : null}
          {!points.length ? (
            <text x={width / 2} y={(priceTop + priceBottom) / 2} textAnchor="middle" className="empty">
              目前沒有成交資料
            </text>
          ) : null}

          {hover ? (
            <>
              <line x1={hover.x} x2={hover.x} y1={priceTop} y2={volTop + volH} className="hover-line" />
              <circle cx={hover.x} cy={hover.y} r="3.5" className={`dot ${lineTone}`} />
            </>
          ) : null}
        </svg>
        {hover ? (
          <div
            className="spark-tip"
            style={{
              left: flip ? undefined : hover.x + 12,
              right: flip ? width - hover.x + 12 : undefined,
              top: Math.min(Math.max(hover.y - 28, priceTop), priceBottom - 24),
            }}
          >
            {`${hover.t}  ${formatPrice(hover.p)}  外 ${hover.out == null ? '—' : Math.round(hover.out).toLocaleString('zh-TW')}  內 ${hover.inn == null ? '—' : Math.round(hover.inn).toLocaleString('zh-TW')}  差 ${hover.net == null ? '—' : signedLots(hover.net)}  累計 ${hover.cum == null ? '—' : signedLots(hover.cum)}`}
          </div>
        ) : null}
      </div>
    </article>
  )
}
export function WatchPage({ slots }: { slots: DeskSlots | null }) {
  const [items, setItems] = useState<Item[]>(loadItems)
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [macro, setMacro] = useState<MacroSnapshot | null>(null)
  const [ticker, setTicker] = useState<TickerItem[]>([])
  const [books, setBooks] = useState<Record<string, SparkBook>>({})
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StockHit[]>([])
  const [notice, setNotice] = useState('')
  const [dockHold, setDockHold] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [liveOn, setLiveOn] = useState(false)
  const dockRef = useRef<HTMLElement>(null)

  const releaseDock = () => {
    setDockHold(false)
    const active = document.activeElement
    if (active instanceof HTMLElement && dockRef.current?.contains(active)) active.blur()
  }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  useEffect(() => {
    let stop = false
    const pullMacro = async () => {
      try {
        const res = await fetch('/api/board/snapshot')
        if (!res.ok || stop) return
        setMacro((await res.json()) as MacroSnapshot)
      } catch {
        /* 看盤仍可用即時報價 */
      }
    }
    void pullMacro()
    const timer = window.setInterval(() => void pullMacro(), 30000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let stop = false
    const pullLive = async () => {
      try {
        const res = await fetch('/api/board/live')
        if (!res.ok || stop) return
        const body = (await res.json()) as { connected?: boolean }
        setLiveOn(Boolean(body.connected))
      } catch {
        if (!stop) setLiveOn(false)
      }
    }
    void pullLive()
    const timer = window.setInterval(() => void pullLive(), 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let stop = false
    const pull = async () => {
      const list = [
        't00:twse',
        ...items.map((item) => `${item.symbol}:${item.market}`),
      ].join(',')
      try {
        const res = await fetch(`/api/board/quotes?items=${encodeURIComponent(list)}`)
        if (!res.ok || stop) return
        setQuotes((await res.json()) as QuoteRow[])
      } catch {
        /* 下一輪再抓 */
      }
    }
    void pull()
    /** 台新連上時加快輪詢，加權時間才會跟著跳 */
    const timer = window.setInterval(() => void pull(), liveOn ? 2000 : 20000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [items, liveOn])

  const chartItems = items.filter((item) => item.chart)
  const chartKey = chartItems.map((item) => `${item.market}:${item.symbol}`).join(',')

  useEffect(() => {
    let stop = false
    const symbols = chartItems.map((item) => `${item.symbol}:${item.market}`).join(',')
    const pull = async () => {
      if (!symbols) {
        if (!stop) setBooks({})
        return
      }
      try {
        const res = await fetch(`/api/board/spark?items=${encodeURIComponent(symbols)}`)
        if (!res.ok || stop) return
        const rows = (await res.json()) as SparkBook[]
        // 某一輪少了某檔（來源暫時失敗）就沿用上一份，漲跌停線與 Y 軸不會跳
        setBooks((prev) => {
          const next: Record<string, SparkBook> = {}
          for (const item of chartItems) if (prev[item.symbol]) next[item.symbol] = prev[item.symbol]
          for (const row of rows) next[row.symbol] = row
          return next
        })
      } catch {
        /* 下一輪再讀行情檔 */
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
    // chartKey 已涵蓋勾選結果
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey])

  const tickerKey = chartItems.map((item) => `${item.symbol}:${item.market}:${item.name}`).join(',')
  const tickerShown = ticker.filter(
    (item) => item.kind !== 'stock' || chartItems.some((row) => row.symbol === item.symbol),
  )

  useEffect(() => {
    let stop = false
    const pull = async () => {
      const res = await fetch(`/api/board/ticker?items=${encodeURIComponent(tickerKey)}`)
      if (!res.ok || stop) return
      setTicker((await res.json()) as TickerItem[])
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 30000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [tickerKey])

  useEffect(() => {
    const text = query.trim()
    if ([...text].length < 1) {
      setHits([])
      return
    }
    let cancel = false
    const timer = window.setTimeout(() => {
      void searchStocks(text).then((found) => {
        if (!cancel) setHits(found)
      })
    }, 180)
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [query])

  const bySymbol = useMemo(
    () => new Map(quotes.map((quote) => [quote.symbol, quote])),
    [quotes],
  )
  const index = bySymbol.get('t00')
  const indexPrice = index?.price ?? macro?.index.price ?? null
  const indexChange = index?.change ?? macro?.index.change ?? null
  const indexPct = index?.pct ?? macro?.index.pct ?? null
  // 同 OneWebStock：排除母類別，依「成交占比 × 類股漲跌幅」排流入／流出前五
  const FLOW_PARENTS = ['電子', '電子工業', '化學生技醫療']
  const withFlow = (macro?.sectors ?? []).filter((row) => row.flow != null && !FLOW_PARENTS.includes(row.name))
  const score = (row: { flow: number | null; pct: number }) => (row.flow ?? 0) * row.pct
  // 依成交占比×漲跌幅；若全日無上漲類股，流入改列分數最高的相對強勢，避免整欄空白
  const rankedUp = [...withFlow].sort((a, b) => score(b) - score(a))
  const rankedDown = [...withFlow].sort((a, b) => score(a) - score(b))
  const upOnly = rankedUp.filter((row) => row.pct > 0).slice(0, 5)
  const downOnly = rankedDown.filter((row) => row.pct < 0).slice(0, 5)
  const inflow = upOnly.length ? upOnly : rankedUp.slice(0, 5)
  const outflow = downOnly.length ? downOnly : rankedDown.slice(0, 5)
  const flowDay =
    (macro?.index.date && macro.index.date.length === 8
      ? `${Number(macro.index.date.slice(4, 6))}月${Number(macro.index.date.slice(6))}日`
      : '') + (macro?.sectorsTime ? ` ${macro.sectorsTime.slice(0, 5)} 更新` : '')

  const addHit = (hit: StockHit) => {
    let added = false
    setItems((prev) => {
      if (prev.some((item) => item.symbol === hit.symbol)) return prev
      added = true
      return [...prev, { symbol: hit.symbol, name: hit.name, market: hit.market, chart: false }]
    })
    setQuery('')
    setHits([])
    setNotice(added ? `已加入 ${hit.symbol} ${hit.name}` : `${hit.symbol} 已在報價列表`)
    setDockHold(true)
  }

  const submit = async () => {
    const resolved = await resolveStockQuery(query)
    if (resolved.status === 'one') addHit(resolved.stock)
    else if (resolved.status === 'code') {
      setNotice('請從清單點選，才能確認上市或上櫃')
    } else if (resolved.status === 'many') {
      setHits(resolved.stocks)
      setNotice('找到多檔，請點選')
    } else setNotice('找不到這檔')
  }

  const toggleChart = (symbol: string) => {
    setNotice('')
    setItems((prev) =>
      prev.map((item) =>
        item.symbol === symbol ? { ...item, chart: !item.chart } : item,
      ),
    )
  }

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    setItems((prev) => {
      const next = [...prev]
      const [row] = next.splice(from, 1)
      next.splice(to, 0, row)
      return next
    })
  }

  return (
    <div className="watch">
      {slots
        ? createPortal(
            <div className="title-stack watch-title">
              <p className="title-main">
                <span
                  className={liveOn ? 'live-dot on' : 'live-dot off'}
                  title={liveOn ? '台新即時行情已連線' : '台新即時行情未連線'}
                  aria-label={liveOn ? '台新即時行情已連線' : '台新即時行情未連線'}
                  role="status"
                />
                <span className="kicker">台股看盤</span>
                <span className={`index-inline ${tone(indexChange)}`}>
                  加權 {fmt(indexPrice, 2)}
                  <b>
                    {signed(indexChange)} {signed(indexPct)}%
                  </b>
                </span>
              </p>
              <p className="asof">
                {index?.time ? `${index.time} 更新` : '等待報價'}
              </p>
            </div>,
            slots.left,
          )
        : null}
      {slots
        ? createPortal(
            <form
              className="join-form"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <label className="sr-only" htmlFor="join-symbol">
                加入報價
              </label>
              <input
                id="join-symbol"
                value={query}
                placeholder="輸入代號或名稱，例如 2330、台積電"
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
              {hits.length > 0 && query.trim() ? (
                <div className="join-hits">
                  {hits.map((hit) => (
                    <button key={hit.symbol} type="button" onClick={() => addHit(hit)}>
                      {hit.symbol} {hit.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {notice ? <p className="join-notice">{notice}</p> : null}
              <button type="submit">加入</button>
            </form>,
            slots.right,
          )
        : null}

      <div className="ticker" aria-label="市場、川普與勾選個股新聞">
        {tickerShown.length ? (
          <div className="ticker-track">
            {[0, 1].map((copy) => (
              <div className="ticker-seq" key={copy} aria-hidden={copy === 1}>
                {tickerShown.map((item) => (
                  <a
                    key={`${copy}-${item.url}`}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={`tick-tag ${item.kind}`}>{item.tag}</span>
                    {item.time ? <time>{item.time}</time> : null}
                    <span className="tick-title">{item.title}</span>
                  </a>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="ticker-empty">盤中每 3 分鐘更新市場、川普與勾選個股的新聞</p>
        )}
      </div>

      <section className="sector-board">
        <div className="sector-head">
          <h2>大盤資金流向</h2>
          <p className="hint">{flowDay}</p>
        </div>
        <div className="sector-cols">
          <div className="sector-col in">
            <h3>流入前五</h3>
            <span className="col-label">成交占比</span>
            <span className="col-label">漲跌幅</span>
            <ol>
              {inflow.map((row, i) => (
                <li key={row.name}>
                  <span>
                    {i + 1} {row.name}
                  </span>
                  <span className="flow-rate">{fmt(row.flow, 2)}%</span>
                  <span className={tone(row.pct)}>{signed(row.pct)}%</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="sector-col out">
            <h3>流出前五</h3>
            <span className="col-label">成交占比</span>
            <span className="col-label">漲跌幅</span>
            <ol>
              {outflow.map((row, i) => (
                <li key={row.name}>
                  <span>
                    {i + 1} {row.name}
                  </span>
                  <span className="flow-rate">{fmt(row.flow, 2)}%</span>
                  <span className={tone(row.pct)}>{signed(row.pct)}%</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <div className="spark-scroll">
        <section className="spark-row">
          {chartItems.map((item) => (
            <Spark
              key={item.symbol}
              item={item}
              quote={bySymbol.get(item.symbol)}
              book={books[item.symbol]}
            />
          ))}
        </section>
      </div>

      <aside
        ref={dockRef}
        className={dockHold ? 'quote-dock open' : 'quote-dock'}
        onMouseLeave={releaseDock}
      >
        <div className="dock-tab">報價列表</div>
        <div className="dock-body">
          <div className="dock-meta">
            <span>
              共 {items.length} 檔，已選 {chartItems.length} 檔走勢
            </span>
            <span>拖曳列可調整順序</span>
            {notice ? <span className="notice">{notice}</span> : null}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>走勢</th>
                  <th>代號</th>
                  <th>名稱</th>
                  <th>成交</th>
                  <th>漲跌</th>
                  <th>漲跌幅</th>
                  <th>買進</th>
                  <th>賣出</th>
                  <th>成交量</th>
                  <th>開盤</th>
                  <th>最高</th>
                  <th>最低</th>
                  <th>昨收</th>
                  <th>時間</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!items.length && (
                  <tr>
                    <td colSpan={99} className="quote-empty">
                      列表是空的，輸入股票代號加入
                    </td>
                  </tr>
                )}
                {items.map((item, index) => {
                  const quote = bySymbol.get(item.symbol)
                  return (
                    <tr
                      key={item.symbol}
                      draggable
                      onDragStart={() => setDragFrom(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragFrom != null) move(dragFrom, index)
                        setDragFrom(null)
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={item.chart}
                          aria-label={`${item.symbol} 顯示走勢`}
                          onChange={() => toggleChart(item.symbol)}
                        />
                      </td>
                      <td>{item.symbol}</td>
                      <td>
                        {quote?.name || item.name}
                        <small>{item.market === 'tpex' ? '上櫃' : '上市'}</small>
                      </td>
                      <td className={tone(quote?.change)}>{fmt(quote?.price ?? null)}</td>
                      <td className={tone(quote?.change)}>{signed(quote?.change ?? null)}</td>
                      <td className={tone(quote?.change)}>{signed(quote?.pct ?? null)}%</td>
                      <td>{fmt(quote?.bid ?? null)}</td>
                      <td>{fmt(quote?.ask ?? null)}</td>
                      <td>{quote?.volume == null ? '—' : fmt(quote.volume, 0)}</td>
                      <td>{fmt(quote?.open ?? null)}</td>
                      <td>{fmt(quote?.high ?? null)}</td>
                      <td>{fmt(quote?.low ?? null)}</td>
                      <td>{fmt(quote?.prev ?? null)}</td>
                      <td>{quote?.time || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() =>
                            setItems((prev) => prev.filter((row) => row.symbol !== item.symbol))
                          }
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </div>
  )
}

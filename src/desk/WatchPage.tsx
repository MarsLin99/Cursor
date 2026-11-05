import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveStockQuery, searchStocks, type StockHit } from '../lib/marketData'
import type { DeskSlots } from './DeskApp'
import { fmt, signed, tone } from './format'
import type { MacroSnapshot, QuoteRow, SparkBook, TickerItem } from './types'

type Item = {
  symbol: string
  name: string
  market: 'twse' | 'tpex'
  chart: boolean
}

const STORAGE_KEY = 'desk-watchlist-v2'
const DEFAULTS: Item[] = [
  { symbol: '2330', name: '台積電', market: 'twse', chart: false },
  { symbol: '00631L', name: '元大台灣50正2', market: 'twse', chart: false },
  { symbol: '00409A', name: '主動復華全球50', market: 'twse', chart: true },
  { symbol: '2385', name: '群光', market: 'twse', chart: true },
  { symbol: '2618', name: '長榮航', market: 'twse', chart: true },
  { symbol: '3363', name: '上詮', market: 'tpex', chart: true },
]

function loadItems(): Item[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Item[]
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULTS
    return parsed
  } catch {
    return DEFAULTS
  }
}

const SESSION_START = 9 * 60
const SESSION_END = 13 * 60 + 30

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
  return { up: anchor * 1.1, down: anchor * 0.9 }
}

function minuteOf(stamp: string) {
  const [hour, minute, second] = stamp.split(':').map(Number)
  return hour * 60 + minute + (second || 0) / 60
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
  const width = 280
  const height = 229
  const plotLeft = 68
  const priceTop = 15
  const priceH = 130
  const forceTop = 163
  const forceH = 48
  const band = priceBand(book)
  const limitUp = band?.up ?? null
  const limitDown = band?.down ?? null
  const open = book?.open ?? quote?.open ?? null
  const price = book?.price ?? quote?.price ?? null
  const change = quote?.change ?? (price != null && book?.prev != null ? price - book.prev : null)
  const ready = limitUp != null && limitDown != null && limitUp > limitDown
  const span = ready ? limitUp - limitDown : 1
  const xOf = (stamp: string) => {
    const minute = minuteOf(stamp)
    const clamped = Math.min(SESSION_END, Math.max(SESSION_START, minute))
    return plotLeft + ((clamped - SESSION_START) / (SESSION_END - SESSION_START)) * (width - plotLeft)
  }
  const yOf = (value: number) => priceTop + ((limitUp! - value) / span) * priceH
  const points = book?.points ?? []
  const line = points.map((point) => `${xOf(point.t)},${yOf(point.p)}`).join(' ')
  const last = points.at(-1)
  const rising = (change ?? 0) >= 0
  const force = book?.force ?? []
  const extreme = Math.max(...force.map((point) => Math.abs(point.d)), 1)
  const yForce = (value: number) => forceTop + ((extreme - value) / (extreme * 2)) * forceH
  // 每分鐘取最後一筆累積內外盤張數差，畫成以 0 為基準的條狀圖
  const forceBars = [
    ...force
      .reduce((byMinute, point) => {
        byMinute.set(Math.min(SESSION_END, Math.max(SESSION_START, minuteOf(point.t))), point)
        return byMinute
      }, new Map<number, (typeof force)[number]>())
      .values(),
  ]
  const barW = Math.max(0.6, ((width - plotLeft) / (SESSION_END - SESSION_START)) * 0.8)
  // 條狀圖：每分鐘外盤減內盤的淨張數；折線：累積張數差
  const minuteNet = forceBars.map((point, i) => ({ t: point.t, d: point.d, net: point.d - (i > 0 ? forceBars[i - 1].d : 0) }))
  const netExtreme = Math.max(...minuteNet.map((point) => Math.abs(point.net)), 1)
  const yNet = (value: number) => forceTop + ((netExtreme - value) / (netExtreme * 2)) * forceH
  const cumLine = forceBars.map((point) => `${xOf(point.t)},${yForce(point.d)}`).join(' ')
  const bias = book?.bias ?? force.at(-1)?.d ?? 0
  const digits = price != null && price >= 1000 ? 0 : 2
  return (
    <article className="spark-card">
      <header>
        <strong>
          {item.symbol} {book?.name || item.name}
        </strong>
        <span className={tone(change)}>
          {fmt(price, digits)}
          <small>
            {signed(change, digits)} {signed(book?.prev && change != null ? (change / book.prev) * 100 : quote?.pct ?? null)}%
          </small>
        </span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${item.name} 當日走勢`}>
        {ready ? (
          <>
            <line x1={plotLeft} x2={width} y1={yOf(limitUp)} y2={yOf(limitUp)} className="limit-up" />
            <text x="0" y={yOf(limitUp)} dominantBaseline="middle" className="tag up">
              漲停 {fmt(limitUp, digits)}
            </text>
            {open != null ? (
              <>
                <line x1={plotLeft} x2={width} y1={yOf(open)} y2={yOf(open)} className="open-line" />
                <text x="0" y={yOf(open)} dominantBaseline="middle" className="tag open">
                  開盤 {fmt(open, digits)}
                </text>
              </>
            ) : null}
            <line x1={plotLeft} x2={width} y1={yOf(limitDown)} y2={yOf(limitDown)} className="limit-down" />
            <text x="0" y={yOf(limitDown)} dominantBaseline="middle" className="tag down">
              跌停 {fmt(limitDown, digits)}
            </text>
            {points.length > 1 ? (
              <polyline points={line} className={rising ? 'price up' : 'price down'} />
            ) : null}
            {last ? <circle cx={xOf(last.t)} cy={yOf(last.p)} r="2.4" className={rising ? 'dot up' : 'dot down'} /> : null}
          </>
        ) : (
          <text x="8" y="48" className="wait">
            等待台新行情
          </text>
        )}
        <text x="0" y={yForce(0)} dominantBaseline="middle" className="force-label">
          買賣力道 {signed(bias, 0)}
        </text>
        <line x1={plotLeft} x2={width} y1={yForce(0)} y2={yForce(0)} className="zero" />
        {minuteNet.map((point) => {
          const y0 = yNet(0)
          const y = yNet(point.net)
          return (
            <rect
              key={point.t}
              x={xOf(point.t) - barW / 2}
              y={Math.min(y, y0)}
              width={barW}
              height={Math.max(0.5, Math.abs(y - y0))}
              className={point.net >= 0 ? 'force-bar up' : 'force-bar down'}
            />
          )
        })}
        {forceBars.length > 1 ? <polyline points={cumLine} className="force-cum" /> : null}
      </svg>
      <footer style={{ paddingLeft: `${(plotLeft / width) * 100}%` }}>
        <span>09:00</span>
        <span>10:00</span>
        <span>11:00</span>
        <span>12:00</span>
        <span>13:30</span>
      </footer>
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
    const symbols = chartItems.map((item) => item.symbol).join(',')
    const pull = async () => {
      if (!symbols) {
        if (!stop) setBooks({})
        return
      }
      try {
        const res = await fetch(`/api/board/spark?items=${encodeURIComponent(symbols)}`)
        if (!res.ok || stop) return
        const rows = (await res.json()) as SparkBook[]
        const next: Record<string, SparkBook> = {}
        for (const row of rows) next[row.symbol] = row
        setBooks(next)
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
  const withFlow = (macro?.sectors ?? []).filter((row) => row.flow != null)
  const inflow = withFlow
    .filter((row) => row.pct > 0)
    .sort((a, b) => (b.flow ?? 0) - (a.flow ?? 0))
    .slice(0, 5)
  const outflow = withFlow
    .filter((row) => row.pct < 0)
    .sort((a, b) => (b.flow ?? 0) - (a.flow ?? 0))
    .slice(0, 5)
  const flowDay =
    macro?.index.date && macro.index.date.length === 8
      ? `${Number(macro.index.date.slice(4, 6))}月${Number(macro.index.date.slice(6))}日`
      : ''

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

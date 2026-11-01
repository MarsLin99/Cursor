import { useEffect, useMemo, useRef, useState } from 'react'
import { CandleChart } from './components/CandleChart'
import { EventModal } from './components/EventModal'
import { pickEventsForReplay, scoreHedgeChoice } from './lib/events'
import { formatMoney, formatNumber, formatPct } from './lib/format'
import { loadStockSeries, SUGGESTED_SYMBOLS } from './lib/marketData'
import { usePaperTrade } from './hooks/usePaperTrade'
import type {
  EventOccurrence,
  HedgeChoice,
  IndicatorSettings,
  ReplaySpeed,
  StockSeries,
} from './types'
import './App.css'

const DEFAULT_INDICATORS: IndicatorSettings = {
  ma5: true,
  ma20: true,
  ma60: false,
  ema12: false,
  ema26: false,
  bb: false,
  rsi: false,
  macd: false,
  kd: true,
}

const INDICATOR_LABELS: { key: keyof IndicatorSettings; label: string }[] = [
  { key: 'ma5', label: 'MA5' },
  { key: 'ma20', label: 'MA20' },
  { key: 'ma60', label: 'MA60' },
  { key: 'ema12', label: 'EMA12' },
  { key: 'ema26', label: 'EMA26' },
  { key: 'bb', label: '布林通道' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
  { key: 'kd', label: 'KD' },
]

const LOT = 1000

export default function App() {
  const [symbolInput, setSymbolInput] = useState('2330')
  const [series, setSeries] = useState<StockSeries | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(40)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<ReplaySpeed>(2)
  const [indicators, setIndicators] = useState(DEFAULT_INDICATORS)
  const [qtyLots, setQtyLots] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const [events, setEvents] = useState<EventOccurrence[]>([])
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [debrief, setDebrief] = useState<string | null>(null)

  const trade = usePaperTrade()
  const timerRef = useRef<number | null>(null)

  const visibleCandles = useMemo(() => {
    if (!series) return []
    return series.candles.slice(0, Math.max(2, cursor + 1))
  }, [series, cursor])

  const last = visibleCandles[visibleCandles.length - 1]
  const mark = last?.close ?? 0
  const equity = trade.equity(mark)
  const unrealized = trade.unrealized(mark)
  const totalPnl = equity - trade.state.initialCash

  const pendingEvent = events.find(
    (e) => e.event.id === activeEventId && !e.resolved && e.choice == null,
  )

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  const load = async (raw: string) => {
    setLoading(true)
    setError(null)
    setPlaying(false)
    setStarted(false)
    setDebrief(null)
    setActiveEventId(null)
    trade.reset()
    try {
      const data = await loadStockSeries(raw)
      setSeries(data)
      const warm = Math.min(50, Math.floor(data.candles.length * 0.2))
      setCursor(warm)
      const picked = pickEventsForReplay(data.candles.length, warm, 3)
      setEvents(
        picked.map(({ triggerIndex, event }) => ({
          event,
          triggerIndex,
          resolveIndex: Math.min(
            data.candles.length - 1,
            triggerIndex + 5 + (event.severity === 'crash' ? 3 : 0),
          ),
          choice: null,
          resultPnl: null,
          resolved: false,
        })),
      )
      setStarted(true)
      showToast(
        data.source === 'demo'
          ? '行情來源暫時改用示範資料'
          : `已載入 ${data.name}（${data.source.toUpperCase()}）`,
      )
    } catch (e) {
      setSeries(null)
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('2330')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!playing || !series || pendingEvent) {
      if (timerRef.current) window.clearInterval(timerRef.current)
      return
    }
    timerRef.current = window.setInterval(() => {
      setCursor((c) => {
        const next = c + 1
        if (next >= series.candles.length) {
          setPlaying(false)
          return c
        }
        const hit = events.find(
          (ev) => ev.triggerIndex === next && ev.choice == null && !ev.resolved,
        )
        if (hit) {
          setPlaying(false)
          setActiveEventId(hit.event.id)
        }
        return next
      })
    }, 900 / speed)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [playing, series, speed, pendingEvent, events])

  // Resolve hedge outcomes after forward candles
  useEffect(() => {
    if (!series) return
    const due = events.filter(
      (ev) => !ev.resolved && ev.choice != null && cursor >= ev.resolveIndex,
    )
    if (!due.length) return

    const latest = due[due.length - 1]
    const start = series.candles[latest.triggerIndex].close
    const end = series.candles[latest.resolveIndex].close
    const movePct = (end - start) / start
    const scored = scoreHedgeChoice(latest.choice!, movePct, latest.event.bias)
    setDebrief(
      `【${latest.event.title}】現貨區間漲跌 ${formatPct(movePct * 100)}；你的策略近似損益 ${formatPct(scored.pnlPct * 100)}（評等 ${scored.grade}）。${scored.comment}`,
    )
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.resolved || ev.choice == null || cursor < ev.resolveIndex) {
          return ev
        }
        const s = series.candles[ev.triggerIndex].close
        const e = series.candles[ev.resolveIndex].close
        const m = (e - s) / s
        const result = scoreHedgeChoice(ev.choice, m, ev.event.bias)
        return { ...ev, resolved: true, resultPnl: result.pnlPct }
      }),
    )
  }, [cursor, series, events])

  const onChooseHedge = (choice: HedgeChoice) => {
    setEvents((prev) =>
      prev.map((ev) =>
        ev.event.id === activeEventId ? { ...ev, choice } : ev,
      ),
    )
    setActiveEventId(null)
    showToast('已記入避險決策，繼續走圖觀察結果')
    setPlaying(true)
  }

  const doBuy = () => {
    if (!last) return
    const qty = qtyLots * LOT
    const res = trade.buy(last.close, qty, cursor, last.time)
    showToast(res.ok ? `買進 ${qty} 股 @ ${formatNumber(last.close)}` : res.reason)
  }

  const doSell = () => {
    if (!last) return
    const qty = qtyLots * LOT
    const res = trade.sell(last.close, qty, cursor, last.time)
    showToast(res.ok ? `賣出 ${qty} 股 @ ${formatNumber(last.close)}` : res.reason)
  }

  const sourceLabel =
    series?.source === 'twse'
      ? '證交所日K'
      : series?.source === 'yahoo'
        ? 'Yahoo Finance'
        : series?.source === 'demo'
          ? '示範資料'
          : '—'

  const activeMarker = events.find(
    (e) => e.triggerIndex <= cursor && (!e.resolved || e.triggerIndex === cursor),
  )?.triggerIndex

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden />
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">走圖道場</p>
          <p className="tagline">真實 K 線練進出場，突發事件練選擇權避險</p>
        </div>
        <form
          className="symbol-form"
          onSubmit={(e) => {
            e.preventDefault()
            void load(symbolInput)
          }}
        >
          <label className="sr-only" htmlFor="symbol">
            股票代號
          </label>
          <input
            id="symbol"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="輸入代號，如 2330"
            inputMode="numeric"
          />
          <button type="submit" disabled={loading}>
            {loading ? '載入中…' : '開始練習'}
          </button>
        </form>
      </header>

      <div className="suggest-row">
        {SUGGESTED_SYMBOLS.map((s) => (
          <button
            key={s.symbol}
            type="button"
            className="chip"
            onClick={() => {
              setSymbolInput(s.symbol)
              void load(s.symbol)
            }}
          >
            {s.symbol} {s.name}
          </button>
        ))}
      </div>

      {error && <div className="banner error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      <main className="workspace">
        <section className="chart-panel">
          <div className="panel-head">
            <div>
              <h1>
                {series ? `${series.symbol} ${series.name}` : '尚未載入'}
              </h1>
              <p className="meta">
                資料來源 {sourceLabel}
                {last
                  ? `｜${last.time}｜收 ${formatNumber(last.close)}`
                  : ''}
                {started
                  ? `｜進度 ${cursor + 1}/${series?.candles.length ?? 0}`
                  : ''}
              </p>
            </div>
            <div className="replay-controls">
              <button
                type="button"
                className="ghost"
                onClick={() => setCursor((c) => Math.max(20, c - 1))}
                disabled={!series || !!pendingEvent}
              >
                上一根
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setPlaying((p) => !p)}
                disabled={!series || !!pendingEvent}
              >
                {playing ? '暫停' : '播放走圖'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (!series) return
                  const next = Math.min(series.candles.length - 1, cursor + 1)
                  const hit = events.find(
                    (ev) =>
                      ev.triggerIndex === next &&
                      ev.choice == null &&
                      !ev.resolved,
                  )
                  setCursor(next)
                  if (hit) {
                    setPlaying(false)
                    setActiveEventId(hit.event.id)
                  }
                }}
                disabled={!series || !!pendingEvent}
              >
                下一根
              </button>
              <label className="speed">
                速度
                <select
                  value={speed}
                  onChange={(e) =>
                    setSpeed(Number(e.target.value) as ReplaySpeed)
                  }
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                  <option value={8}>8x</option>
                </select>
              </label>
            </div>
          </div>

          <div className="chart-wrap">
            {visibleCandles.length > 2 ? (
              <CandleChart
                candles={visibleCandles}
                indicators={indicators}
                trades={trade.state.trades.filter((t) => t.candleIndex <= cursor)}
                markerIndex={activeMarker ?? null}
              />
            ) : (
              <div className="chart-empty">載入 K 線後即可開始走圖練習</div>
            )}
          </div>

          {debrief && <aside className="debrief">{debrief}</aside>}
        </section>

        <aside className="side-panel">
          <section className="card-block">
            <h2>帳戶概況</h2>
            <div className="stat-grid">
              <div>
                <span>權益</span>
                <strong>{formatMoney(equity)}</strong>
              </div>
              <div>
                <span>現金</span>
                <strong>{formatMoney(trade.state.cash)}</strong>
              </div>
              <div>
                <span>持股</span>
                <strong>{trade.state.qty.toLocaleString('zh-TW')} 股</strong>
              </div>
              <div>
                <span>總損益</span>
                <strong className={totalPnl >= 0 ? 'up' : 'down'}>
                  {formatMoney(totalPnl)}
                </strong>
              </div>
              <div>
                <span>未實現</span>
                <strong className={unrealized >= 0 ? 'up' : 'down'}>
                  {formatMoney(unrealized)}
                </strong>
              </div>
              <div>
                <span>已實現</span>
                <strong className={trade.state.realizedPnl >= 0 ? 'up' : 'down'}>
                  {formatMoney(trade.state.realizedPnl)}
                </strong>
              </div>
            </div>
          </section>

          <section className="card-block">
            <h2>現貨進出</h2>
            <p className="hint">以當根收盤價模擬成交，1 張 = 1,000 股</p>
            <div className="trade-row">
              <label>
                張數
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={qtyLots}
                  onChange={(e) =>
                    setQtyLots(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </label>
              <button type="button" className="buy" onClick={doBuy} disabled={!last}>
                買進
              </button>
              <button type="button" className="sell" onClick={doSell} disabled={!last}>
                賣出
              </button>
            </div>
            <button
              type="button"
              className="ghost full"
              onClick={() => {
                trade.reset()
                showToast('已重置模擬帳戶（400 萬本金）')
              }}
            >
              重置帳戶
            </button>
          </section>

          <section className="card-block">
            <h2>技術指標</h2>
            <div className="indicator-grid">
              {INDICATOR_LABELS.map((item) => (
                <label key={item.key} className="check">
                  <input
                    type="checkbox"
                    checked={indicators[item.key]}
                    onChange={(e) =>
                      setIndicators((prev) => ({
                        ...prev,
                        [item.key]: e.target.checked,
                      }))
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </section>

          <section className="card-block">
            <h2>避險事件進度</h2>
            {events.length === 0 ? (
              <p className="hint">載入足夠長的歷史後會安排突發事件關卡。</p>
            ) : (
              <ul className="event-list">
                {events.map((ev) => (
                  <li key={ev.event.id}>
                    <div className="event-list-title">
                      <span>{ev.event.title}</span>
                      <em>
                        {ev.resolved
                          ? '已結算'
                          : ev.choice
                            ? '觀察中'
                            : cursor >= ev.triggerIndex
                              ? '待決策'
                              : `約第 ${ev.triggerIndex + 1} 根`}
                      </em>
                    </div>
                    {ev.choice && (
                      <p className="hint">
                        決策：
                        {
                          ev.event.choices.find((c) => c.id === ev.choice)
                            ?.label
                        }
                        {ev.resultPnl != null
                          ? `｜結果 ${formatPct(ev.resultPnl * 100)}`
                          : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card-block coach">
            <h2>練習建議</h2>
            <ol>
              <li>先用指標判斷趨勢，再決定現貨加減碼。</li>
              <li>事件跳出時，想的是「保護下檔」還是「保留上漲」。</li>
              <li>走完後對照評等：不是每次都該買 Put。</li>
            </ol>
          </section>
        </aside>
      </main>

      {pendingEvent && last && (
        <EventModal
          event={pendingEvent.event}
          spotPrice={last.close}
          onChoose={onChooseHedge}
        />
      )}

      <footer className="footer">
        本工具僅供技術分析與避險策略練習，非投資建議。台股日 K
        優先取自證交所公開資訊；失敗時改用備援或示範資料。
      </footer>
    </div>
  )
}

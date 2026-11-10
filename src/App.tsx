import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeskSlots } from './desk/DeskApp'
import { CandleChart } from './components/CandleChart'
import { EventModal } from './components/EventModal'
import { pickEventsForReplay } from './lib/events'
import { clamp, formatMoney, formatNumber, formatPct } from './lib/format'
import {
  loadStockSeries,
  resolveStockQuery,
  searchStocks,
  SUGGESTED_SYMBOLS,
  type StockHit,
} from './lib/marketData'
import {
  buildOptionLegs,
  describeLeg,
  markOptionPremium,
  optionCloseCashDelta,
  optionOpenCashDelta,
  optionToClosedRound,
  optionUnrealized,
  strategyNeedsContracts,
} from './lib/options'
import {
  buildPerformance,
  formatProfitFactor,
  formatWinRate,
} from './lib/performance'
import { usePaperTrade } from './hooks/usePaperTrade'
import type {
  ClosedRound,
  EventOccurrence,
  HedgeChoice,
  IndicatorSettings,
  OptionPosition,
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
/** 起點前至少留幾根（MA 初期可能尚未成形，但仍可開始練習） */
const MIN_HISTORY = 20
/** 起點之後至少再留幾根可走 */
const MIN_REMAINING = 10

function startIndexBounds(candleCount: number) {
  const min = Math.min(
    MIN_HISTORY,
    Math.max(5, candleCount - MIN_REMAINING - 1),
  )
  const max = Math.max(min, candleCount - MIN_REMAINING - 1)
  return { min, max }
}

function defaultStartIndex(candleCount: number) {
  const { min, max } = startIndexBounds(candleCount)
  const preferred = Math.min(50, Math.floor(candleCount * 0.2))
  return clamp(Math.max(preferred, min), min, max)
}

export default function App({ slots = null }: { slots?: DeskSlots | null }) {
  const [symbolInput, setSymbolInput] = useState('2330')
  const [hits, setHits] = useState<StockHit[]>([])
  const [hitQuery, setHitQuery] = useState('')
  const [hitsOpen, setHitsOpen] = useState(false)
  const [series, setSeries] = useState<StockSeries | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(40)
  const [startIndex, setStartIndex] = useState(40)
  const [startDateInput, setStartDateInput] = useState('')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<ReplaySpeed>(2)
  const [indicators, setIndicators] = useState(DEFAULT_INDICATORS)
  const [qtyLots, setQtyLots] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const [events, setEvents] = useState<EventOccurrence[]>([])
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [debrief, setDebrief] = useState<string | null>(null)
  const [options, setOptions] = useState<OptionPosition[]>([])
  const [guideOpen, setGuideOpen] = useState(false)

  const trade = usePaperTrade()
  const timerRef = useRef<number | null>(null)

  const dateBounds = useMemo(() => {
    if (!series || series.candles.length < 30) return null
    const { min, max } = startIndexBounds(series.candles.length)
    return {
      dataFirst: series.candles[0].time,
      dataLast: series.candles[series.candles.length - 1].time,
      minDate: series.candles[min].time,
      maxDate: series.candles[max].time,
      min,
      max,
      total: series.candles.length,
    }
  }, [series])

  /** 只有實際有 K 線的交易日可選 */
  const tradeDays = useMemo(() => {
    if (!series || !dateBounds) return []
    return series.candles.slice(dateBounds.min, dateBounds.max + 1).map((c, i) => ({
      index: dateBounds.min + i,
      time: c.time,
    }))
  }, [series, dateBounds])

  const selectedTradeOffset = useMemo(() => {
    const idx = tradeDays.findIndex((d) => d.time === startDateInput)
    return idx >= 0 ? idx : 0
  }, [tradeDays, startDateInput])

  const visibleCandles = useMemo(() => {
    if (!series) return []
    return series.candles.slice(0, Math.max(2, cursor + 1))
  }, [series, cursor])

  const last = visibleCandles[visibleCandles.length - 1]
  const mark = last?.close ?? 0

  const openOptions = useMemo(
    () => options.filter((o) => !o.closed),
    [options],
  )

  const optionMarks = useMemo(() => {
    const map = new Map<string, number>()
    for (const pos of openOptions) {
      map.set(
        pos.id,
        markOptionPremium(pos, mark, Math.max(0, cursor - pos.openIndex)),
      )
    }
    return map
  }, [openOptions, mark, cursor])

  const optionsUnrealized = useMemo(() => {
    let sum = 0
    for (const pos of openOptions) {
      const prem = optionMarks.get(pos.id) ?? pos.entryPremium
      sum += optionUnrealized(pos, prem)
    }
    return sum
  }, [openOptions, optionMarks])

  const spotEquity = trade.equity(mark)
  const equity = spotEquity + optionsUnrealized
  const unrealized = trade.unrealized(mark) + optionsUnrealized
  const totalPnl = equity - trade.state.initialCash

  const performance = useMemo(
    () =>
      buildPerformance(trade.state.closedRounds, trade.state.initialCash),
    [trade.state.closedRounds, trade.state.initialCash],
  )
  const realizedTotal = performance.overall.totalPnl

  const pendingEvent = events.find(
    (e) => e.event.id === activeEventId && !e.resolved && e.choice == null,
  )

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  const beginFromIndex = (
    data: StockSeries,
    index: number,
    opts?: { toast?: string },
  ) => {
    const { min, max } = startIndexBounds(data.candles.length)
    const warm = clamp(index, min, max)
    setPlaying(false)
    setDebrief(null)
    setActiveEventId(null)
    setOptions([])
    trade.reset()
    setSeries(data)
    setStartIndex(warm)
    setCursor(warm)
    setStartDateInput(data.candles[warm]?.time ?? '')
    const picked = pickEventsForReplay(data.candles.length, warm, 3)
    setEvents(
      picked.map(({ triggerIndex, event }) => ({
        event,
        triggerIndex,
        choice: null,
        contracts: null,
        optionIds: [],
        resultPnl: null,
        resolved: false,
      })),
    )
    setStarted(true)
    if (opts?.toast) showToast(opts.toast)
  }

  const applyStartDate = (rawDate: string) => {
    if (!series || !tradeDays.length) return
    const hit = tradeDays.find((d) => d.time === rawDate)
    if (!hit) {
      showToast('請選擇有行情資料的交易日')
      return
    }
    beginFromIndex(series, hit.index, {
      toast: `練習起點改為 ${hit.time}（帳戶已重置）`,
    })
  }

  const nearestTradeDay = (rawDate: string) => {
    if (!tradeDays.length) return ''
    const hit = tradeDays.find((d) => d.time >= rawDate)
    return hit?.time ?? tradeDays[tradeDays.length - 1].time
  }

  const jumpStartPreset = (kind: 'earliest' | '6m' | '1y' | 'latest') => {
    if (!series || !tradeDays.length) return
    const lastTime = tradeDays[tradeDays.length - 1].time
    const end = new Date(`${lastTime}T00:00:00+08:00`)
    let target = tradeDays[0].time
    if (kind === 'earliest') target = tradeDays[0].time
    else if (kind === 'latest') target = lastTime
    else {
      const d = new Date(end)
      d.setMonth(d.getMonth() - (kind === '6m' ? 6 : 12))
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      target = nearestTradeDay(`${y}-${m}-${day}`)
    }
    applyStartDate(target)
  }

  const load = async (raw: string, hint?: StockHit) => {
    setError(null)
    let pick: {
      symbol: string
      name?: string
      market?: StockHit['market'] | 'unknown'
    } = hint ?? { symbol: raw }
    if (!hint) {
      const resolved = await resolveStockQuery(raw)
      if (resolved.status === 'many') {
        setHits(resolved.stocks)
        setHitsOpen(true)
        setError('找到多檔，請從清單點選')
        return
      }
      if (resolved.status === 'none') {
        setHits([])
        setHitsOpen(false)
        setError('找不到這檔股票，請改用代號或完整中文名稱')
        return
      }
      pick =
        resolved.status === 'one'
          ? resolved.stock
          : { symbol: resolved.symbol, market: 'unknown' }
    }

    setLoading(true)
    setPlaying(false)
    setStarted(false)
    setDebrief(null)
    setActiveEventId(null)
    setOptions([])
    trade.reset()
    setHitsOpen(false)
    setSymbolInput(pick.symbol)
    try {
      const data = await loadStockSeries(pick.symbol, {
        name: pick.name,
        market: pick.market,
      })
      const warm = defaultStartIndex(data.candles.length)
      const title = [data.symbol, data.name].filter(Boolean).join(' ')
      beginFromIndex(data, warm, {
        toast:
          data.source === 'demo'
            ? '行情來源暫時改用示範資料'
            : `已載入 ${title}（${data.source.toUpperCase()}）｜起點 ${data.candles[warm].time}`,
      })
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

  // 每次切到走圖道場分頁就顯示操作說明（slots 有值代表此分頁正在顯示）
  useEffect(() => {
    if (slots) setGuideOpen(true)
  }, [slots])

  useEffect(() => {
    if (!guideOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGuideOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guideOpen])

  useEffect(() => {
    const query = symbolInput.trim()
    if (!query) {
      setHits([])
      setHitQuery('')
      return
    }
    let cancel = false
    const timer = window.setTimeout(() => {
      void searchStocks(query).then((found) => {
        if (!cancel) {
          setHits(found)
          setHitQuery(query.replace(/\s+/g, ''))
        }
      })
    }, 180)
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [symbolInput])

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

  const onChooseHedge = (choice: HedgeChoice, contracts: number) => {
    if (!last || !activeEventId) return
    const eventOcc = events.find((e) => e.event.id === activeEventId)
    if (!eventOcc) return

    const qty = Math.max(1, contracts)

    if (choice === 'add_long') {
      const res = trade.buy(last.close, qty * LOT, cursor, last.time)
      if (!res.ok) {
        showToast(res.reason)
        return
      }
      setEvents((prev) =>
        prev.map((ev) =>
          ev.event.id === activeEventId
            ? {
                ...ev,
                choice,
                contracts: qty,
                resolved: true,
                resultPnl: 0,
              }
            : ev,
        ),
      )
      setActiveEventId(null)
      setPlaying(false)
      showToast(`${res.note ?? '已加碼'}；請自行按下一根繼續`)
      return
    }

    if (choice === 'do_nothing') {
      setEvents((prev) =>
        prev.map((ev) =>
          ev.event.id === activeEventId
            ? {
                ...ev,
                choice,
                contracts: 0,
                resolved: true,
                resultPnl: 0,
              }
            : ev,
        ),
      )
      setActiveEventId(null)
      setPlaying(false)
      showToast('未建立選擇權部位；請自行按下一根繼續')
      return
    }

    if (!strategyNeedsContracts(choice)) return

    const legs = buildOptionLegs({
      eventId: eventOcc.event.id,
      eventTitle: eventOcc.event.title,
      choice,
      contracts: qty,
      spot: last.close,
      severity: eventOcc.event.severity,
      candleIndex: cursor,
      time: last.time,
    })

    const cashNeed = legs.reduce((s, leg) => s + optionOpenCashDelta(leg), 0)
    if (trade.state.cash + cashNeed < 0) {
      showToast('現金不足，無法支付權利金')
      return
    }

    for (const leg of legs) {
      trade.applyCash(optionOpenCashDelta(leg))
    }

    setOptions((prev) => [...prev, ...legs])
    setEvents((prev) =>
      prev.map((ev) =>
        ev.event.id === activeEventId
          ? {
              ...ev,
              choice,
              contracts: qty,
              optionIds: legs.map((l) => l.id),
              resolved: false,
            }
          : ev,
      ),
    )
    setActiveEventId(null)
    setPlaying(false)
    showToast(
      `已建立 ${legs.map(describeLeg).join('、')}；不會自動走圖，請自行觀察後平倉`,
    )
  }

  const settleClosedOptions = (
    nextOptions: OptionPosition[],
    closedIds: string[],
  ) => {
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.resolved || !ev.optionIds.some((oid) => closedIds.includes(oid))) {
          return ev
        }
        const stillOpen = nextOptions.some(
          (o) => ev.optionIds.includes(o.id) && !o.closed,
        )
        if (stillOpen) return ev
        const closedPnl = nextOptions
          .filter((o) => ev.optionIds.includes(o.id))
          .reduce((s, o) => s + (o.realizedPnl ?? 0), 0)
        setDebrief(
          `【${ev.event.title}】選擇權已平倉，實現損益 ${formatMoney(closedPnl)}。之後可繼續手動走圖。`,
        )
        return {
          ...ev,
          resolved: true,
          resultPnl: closedPnl,
        }
      }),
    )
  }

  const closeOption = (id: string) => {
    if (!last) return
    const pos = options.find((o) => o.id === id && !o.closed)
    if (!pos) return

    const markPrem = markOptionPremium(
      pos,
      last.close,
      Math.max(0, cursor - pos.openIndex),
    )
    const cashDelta = optionCloseCashDelta(pos, markPrem)
    if (cashDelta < 0 && trade.state.cash + cashDelta < 0) {
      showToast('現金不足，無法買回平倉')
      return
    }

    const realized = optionUnrealized(pos, markPrem)
    trade.applyCash(cashDelta)
    trade.appendRounds([
      optionToClosedRound(pos, markPrem, last.time, realized),
    ])

    const nextOptions = options.map((o) =>
      o.id === id
        ? {
            ...o,
            closed: true,
            closePremium: markPrem,
            closeIndex: cursor,
            closeTime: last.time,
            realizedPnl: realized,
          }
        : o,
    )
    setOptions(nextOptions)
    settleClosedOptions(nextOptions, [id])
    showToast(`已平倉 ${describeLeg(pos)}｜損益 ${formatMoney(realized)}`)
  }

  const closeAllOptions = () => {
    if (!last || openOptions.length === 0) return

    let cash = trade.state.cash
    let nextOptions = [...options]
    const closedIds: string[] = []
    const rounds: ClosedRound[] = []
    let totalRealized = 0

    for (const pos of openOptions) {
      const markPrem = markOptionPremium(
        pos,
        last.close,
        Math.max(0, cursor - pos.openIndex),
      )
      const cashDelta = optionCloseCashDelta(pos, markPrem)
      if (cash + cashDelta < 0) {
        showToast('現金不足，無法一次全部平倉')
        return
      }
      cash += cashDelta
      const realized = optionUnrealized(pos, markPrem)
      totalRealized += realized
      closedIds.push(pos.id)
      rounds.push(optionToClosedRound(pos, markPrem, last.time, realized))
      nextOptions = nextOptions.map((o) =>
        o.id === pos.id
          ? {
              ...o,
              closed: true,
              closePremium: markPrem,
              closeIndex: cursor,
              closeTime: last.time,
              realizedPnl: realized,
            }
          : o,
      )
    }

    trade.applyCash(cash - trade.state.cash)
    trade.appendRounds(rounds)
    setOptions(nextOptions)
    settleClosedOptions(nextOptions, closedIds)
    showToast(`已全部平倉｜損益 ${formatMoney(totalRealized)}`)
  }

  const doBuy = () => {
    if (!last) return
    const qty = qtyLots * LOT
    const res = trade.buy(last.close, qty, cursor, last.time)
    showToast(
      res.ok
        ? `${res.note ?? `買進 ${qty} 股`} @ ${formatNumber(last.close)}`
        : res.reason,
    )
  }

  const doSell = () => {
    if (!last) return
    const qty = qtyLots * LOT
    const res = trade.sell(last.close, qty, cursor, last.time)
    showToast(
      res.ok
        ? `${res.note ?? `賣出 ${qty} 股`} @ ${formatNumber(last.close)}`
        : res.reason,
    )
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
    (e) =>
      e.triggerIndex <= cursor &&
      (e.choice == null || openOptions.some((o) => o.eventId === e.event.id)),
  )?.triggerIndex

  const posLabel =
    trade.state.qty > 0
      ? `多 ${trade.state.qty.toLocaleString('zh-TW')} 股`
      : trade.state.qty < 0
        ? `空 ${(-trade.state.qty).toLocaleString('zh-TW')} 股`
        : '無持股'

  const buyLabel = trade.state.qty < 0 ? '回補／買進' : '買進'
  const sellLabel = trade.state.qty > 0 ? '賣出／放空' : '放空'

  const brandBlock = (
    <div className="brand-block">
      <p className="brand">走圖道場</p>
      <p className="tagline">真實 K 線練進出場，突發事件練選擇權避險</p>
    </div>
  )
  const symbolForm = (
    <form
      className="symbol-form"
      onSubmit={(e) => {
        e.preventDefault()
        void load(symbolInput)
      }}
    >
      <label className="sr-only" htmlFor="symbol">
        股票代號或名稱
      </label>
      <input
        id="symbol"
        value={symbolInput}
        onChange={(e) => {
          setSymbolInput(e.target.value)
          setHitsOpen(true)
        }}
        onFocus={() => setHitsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setHitsOpen(false), 150)
        }}
        placeholder="代號或中文，如 2385、群光"
        autoComplete="off"
      />
      {hitsOpen &&
        hits.length > 0 &&
        hitQuery === symbolInput.trim().replace(/\s+/g, '') && (
        <div className="symbol-hits" role="listbox">
          {hits.map((hit) => (
            <button
              key={`${hit.market}-${hit.symbol}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setHitsOpen(false)
                void load(hit.symbol, hit)
              }}
            >
              <span>
                {hit.symbol} {hit.name}
              </span>
              {hit.fullName && hit.fullName !== hit.name ? (
                <small>
                  {hit.fullName.replace(/股份有限公司|有限公司/g, '')}
                </small>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <button className="symbol-submit" type="submit" disabled={loading}>
        {loading ? '載入中…' : '開始練習'}
      </button>
    </form>
  )

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden />
      {slots ? (
        <>
          {createPortal(brandBlock, slots.left)}
          {createPortal(symbolForm, slots.right)}
        </>
      ) : (
        <header className="topbar">
          {brandBlock}
          {symbolForm}
        </header>
      )}

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

      {dateBounds && tradeDays.length > 0 && (
        <div className="start-row">
          <label className="start-date" htmlFor="start-date">
            起始日
            <select
              id="start-date"
              value={startDateInput}
              onChange={(e) => setStartDateInput(e.target.value)}
              disabled={!!pendingEvent}
            >
              {tradeDays.map((d) => (
                <option key={d.time} value={d.time}>
                  {d.time}
                </option>
              ))}
            </select>
          </label>
          <label className="start-slider" htmlFor="start-slider">
            <span className="sr-only">拖曳選擇交易日</span>
            <input
              id="start-slider"
              type="range"
              min={0}
              max={Math.max(0, tradeDays.length - 1)}
              step={1}
              value={selectedTradeOffset}
              disabled={!!pendingEvent}
              onChange={(e) => {
                const day = tradeDays[Number(e.target.value)]
                if (day) setStartDateInput(day.time)
              }}
            />
          </label>
          <button
            type="button"
            className="ghost"
            onClick={() => applyStartDate(startDateInput)}
            disabled={!startDateInput || !!pendingEvent}
          >
            從此開始
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => jumpStartPreset('earliest')}
            disabled={!!pendingEvent}
          >
            最早可練
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => jumpStartPreset('1y')}
            disabled={!!pendingEvent}
          >
            近一年
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => jumpStartPreset('6m')}
            disabled={!!pendingEvent}
          >
            近半年
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => jumpStartPreset('latest')}
            disabled={!!pendingEvent}
          >
            最新區段
          </button>
          <span className="start-hint">
            資料共 {dateBounds.total} 根（{dateBounds.dataFirst}～
            {dateBounds.dataLast}），可練起點 {dateBounds.minDate}～
            {dateBounds.maxDate}；更改起點會重置帳戶
          </span>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      <main className="workspace">
        <section className="chart-panel">
          <div className="panel-head">
            <div>
              <h1>
                {series
                  ? [series.symbol, series.name].filter(Boolean).join(' ')
                  : '尚未載入'}
              </h1>
              <p className="meta">
                資料來源 {sourceLabel}
                {last
                  ? `｜${last.time}｜收 ${formatNumber(last.close)}`
                  : ''}
                {started
                  ? `｜起點 ${series?.candles[startIndex]?.time ?? '—'}｜進度 ${cursor + 1}/${series?.candles.length ?? 0}`
                  : ''}
              </p>
            </div>
            <div className="replay-controls">
              <button
                type="button"
                className="ghost"
                onClick={() => setCursor((c) => Math.max(startIndex, c - 1))}
                disabled={!series || !!pendingEvent || cursor <= startIndex}
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

          <div
            className="chart-wrap"
            data-subs={
              Number(indicators.rsi) +
              Number(indicators.macd) +
              Number(indicators.kd)
            }
          >
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
                <span>部位</span>
                <strong>{posLabel}</strong>
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
                <strong className={realizedTotal >= 0 ? 'up' : 'down'}>
                  {formatMoney(realizedTotal)}
                </strong>
              </div>
            </div>
          </section>

          <section className="card-block">
            <h2>績效統計</h2>
            {performance.overall.trades === 0 ? (
              <p className="hint">
                平倉現貨或選擇權後，會計算勝率與各年度已實現績效。
              </p>
            ) : (
              <>
                <div className="stat-grid">
                  <div>
                    <span>總勝率</span>
                    <strong>{formatWinRate(performance.overall.winRate)}</strong>
                  </div>
                  <div>
                    <span>已平倉筆數</span>
                    <strong>{performance.overall.trades}</strong>
                  </div>
                  <div>
                    <span>現貨勝率</span>
                    <strong>{formatWinRate(performance.spot.winRate)}</strong>
                  </div>
                  <div>
                    <span>選擇權勝率</span>
                    <strong>{formatWinRate(performance.option.winRate)}</strong>
                  </div>
                  <div>
                    <span>盈虧比</span>
                    <strong>
                      {formatProfitFactor(performance.overall.profitFactor)}
                    </strong>
                  </div>
                  <div>
                    <span>累計報酬</span>
                    <strong className={realizedTotal >= 0 ? 'up' : 'down'}>
                      {formatPct(
                        (realizedTotal / trade.state.initialCash) * 100,
                      )}
                    </strong>
                  </div>
                </div>
                {performance.byYear.length > 0 && (
                  <div className="year-perf">
                    <p className="year-perf-title">年度績效（依平倉日）</p>
                    <ul className="year-perf-list">
                      {performance.byYear.map((y) => (
                        <li key={y.year}>
                          <div className="year-perf-head">
                            <strong>{y.year}</strong>
                            <em className={y.realizedPnl >= 0 ? 'up' : 'down'}>
                              {formatMoney(y.realizedPnl)}
                            </em>
                          </div>
                          <p className="hint">
                            {y.trades} 筆｜勝率 {formatWinRate(y.winRate)}｜報酬{' '}
                            <span className={y.returnPct >= 0 ? 'up' : 'down'}>
                              {formatPct(y.returnPct)}
                            </span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card-block">
            <h2>現貨進出</h2>
            <p className="hint">
              以當根收盤價模擬成交，1 張 = 1,000 股。可做多也可放空。
            </p>
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
              <button
                type="button"
                className="buy"
                onClick={doBuy}
                disabled={!last}
              >
                {buyLabel}
              </button>
              <button
                type="button"
                className="sell"
                onClick={doSell}
                disabled={!last}
              >
                {sellLabel}
              </button>
            </div>
            <button
              type="button"
              className="ghost full"
              onClick={() => {
                trade.reset()
                setOptions([])
                showToast('已重置模擬帳戶（400 萬本金）')
              }}
            >
              重置帳戶
            </button>
          </section>

          <section className="card-block">
            <h2>選擇權部位</h2>
            {openOptions.length === 0 ? (
              <p className="hint">
                事件決策後若建立 Put／Call，會顯示在這裡，由你自行停損停利平倉。
              </p>
            ) : (
              <>
                <ul className="option-list">
                  {openOptions.map((pos) => {
                    const prem =
                      optionMarks.get(pos.id) ?? pos.entryPremium
                    const pnl = optionUnrealized(pos, prem)
                    return (
                      <li key={pos.id}>
                        <div className="option-list-title">
                          <span>{describeLeg(pos)}</span>
                          <em className={pnl >= 0 ? 'up' : 'down'}>
                            {formatMoney(pnl)}
                          </em>
                        </div>
                        <p className="hint">
                          {pos.eventTitle}｜履約 {formatNumber(pos.strike)}｜進場
                          權利金 {formatNumber(pos.entryPremium)}｜現價{' '}
                          {formatNumber(prem)}
                        </p>
                        <button
                          type="button"
                          className="ghost full"
                          onClick={() => closeOption(pos.id)}
                        >
                          平倉
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {openOptions.length > 1 && (
                  <button
                    type="button"
                    className="ghost full"
                    onClick={closeAllOptions}
                  >
                    全部平倉
                  </button>
                )}
              </>
            )}
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
                {events.map((ev) => {
                  const openForEvent = openOptions.filter(
                    (o) => o.eventId === ev.event.id,
                  )
                  return (
                    <li key={ev.event.id}>
                      <div className="event-list-title">
                        <span>{ev.event.title}</span>
                        <em>
                          {ev.resolved
                            ? '已結束'
                            : openForEvent.length
                              ? '持倉中'
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
                          {ev.contracts
                            ? `｜${ev.contracts}${
                                ev.choice === 'add_long' ? ' 張' : ' 口'
                              }`
                            : ''}
                          {typeof ev.resultPnl === 'number' && ev.resolved
                            ? `｜結果 ${formatMoney(ev.resultPnl)}`
                            : ''}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="card-block coach">
            <h2>練習建議</h2>
            <ol>
              <li>事件後自行決定口數，再用下一根慢慢觀察。</li>
              <li>選擇權不會自動結算，停損停利請自己按平倉。</li>
              <li>現貨可放空；回補用買進即可。</li>
            </ol>
          </section>
        </aside>
      </main>

      {guideOpen && slots ? (
        <div
          className="modal-backdrop guide-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dojo-guide-title"
          onClick={() => setGuideOpen(false)}
        >
          <div className="modal-card guide-card" onClick={(e) => e.stopPropagation()}>
            <h2 id="dojo-guide-title">操作說明</h2>
            <p className="guide-lead">用真實日 K 練習買賣，圖會一根一根往前走。</p>
            <ol className="guide-steps">
              <li>輸入股票代號或名稱，按「開始練習」。</li>
              <li>要改練習起點，先選日期再按「從此開始」（帳戶會重置）。</li>
              <li>按「播放走圖」或「上一根／下一根」來看圖，速度可以調。</li>
              <li>右側選張數，按「買進」或「放空」下單（以當根收盤價成交）。</li>
              <li>遇到突發事件會暫停，選完策略按「確認下單」；選擇權要自己按「平倉」。</li>
            </ol>
            <button
              type="button"
              className="primary confirm-choice"
              onClick={() => setGuideOpen(false)}
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}

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

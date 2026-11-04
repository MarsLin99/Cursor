import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type IPaneApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type Time,
  type MouseEventParams,
} from 'lightweight-charts'
import { formatNumber } from '../lib/format'
import type { Candle, IndicatorSettings, Trade } from '../types'
import {
  calcBollinger,
  calcEMA,
  calcKD,
  calcMA,
  calcMACD,
  calcMADeductions,
  calcRSI,
} from '../lib/indicators'

const MA_SPECS = [
  { key: 'ma5' as const, period: 5, label: 'MA5', color: '#E8A838', ema: false },
  { key: 'ma20' as const, period: 20, label: 'MA20', color: '#2F6FED', ema: false },
  { key: 'ma60' as const, period: 60, label: 'MA60', color: '#8B5E3C', ema: false },
  { key: 'ema12' as const, period: 12, label: 'EMA12', color: '#0F3D3E', ema: true },
  { key: 'ema26' as const, period: 26, label: 'EMA26', color: '#7A8B99', ema: true },
]

type Props = {
  candles: Candle[]
  indicators: IndicatorSettings
  trades: Trade[]
  markerIndex?: number | null
}

/** 台股慣例：上漲紅、下跌綠 */
const UP = '#C45C4A'
const DOWN = '#1F7A6C'
/** 最新一根右側留白，避免貼邊 */
const RIGHT_PAD = 2
const DEFAULT_VISIBLE = 80

function pinLatest(
  chart: IChartApi,
  count: number,
  span: number,
  applyingRangeRef: { current: boolean },
  savedRangeRef: { current: LogicalRange | null },
) {
  const to = count + RIGHT_PAD
  const from = to - Math.max(5, span)
  const range = { from, to } as LogicalRange
  applyingRangeRef.current = true
  savedRangeRef.current = range
  chart.timeScale().setVisibleLogicalRange(range)
  requestAnimationFrame(() => {
    applyingRangeRef.current = false
  })
}

type AnySeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>

function addOscillatorPane(chart: IChartApi, title: string): IPaneApi<Time> {
  const pane = chart.addPane()
  pane.setStretchFactor(1)
  pane.priceScale('right').applyOptions({
    borderVisible: false,
    scaleMargins: { top: 0.16, bottom: 0.12 },
  })
  createTextWatermark(pane, {
    horzAlign: 'left',
    vertAlign: 'top',
    lines: [
      {
        text: title,
        color: 'rgba(61, 79, 79, 0.7)',
        fontSize: 12,
        fontFamily: 'Instrument Sans, Noto Sans TC, sans-serif',
      },
    ],
  })
  return pane
}

function indicatorKey(indicators: IndicatorSettings): string {
  return Object.entries(indicators)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .sort()
    .join(',')
}

function toLineData(points: { time: string; value: number }[]) {
  return points.map((p) => ({ time: p.time as Time, value: p.value }))
}

export function CandleChart({
  candles,
  indicators,
  trades,
  markerIndex,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const overlaySeriesRef = useRef<AnySeries[]>([])
  const savedRangeRef = useRef<LogicalRange | null>(null)
  const userAdjustedRef = useRef(false)
  /** 使用者縮放後要保留的可視寬度（以 K 線根數計） */
  const spanRef = useRef<number | null>(null)
  const candleCountRef = useRef(0)
  const dataIdentityRef = useRef('')
  const indicatorKeyRef = useRef('')
  const applyingRangeRef = useRef(false)
  const candlesRef = useRef(candles)
  const [hoverTime, setHoverTime] = useState<string | null>(null)
  candlesRef.current = candles

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#3d4f4f',
        fontFamily: 'Instrument Sans, Noto Sans TC, sans-serif',
        attributionLogo: false,
        panes: {
          separatorColor: 'rgba(15, 61, 62, 0.16)',
          separatorHoverColor: 'rgba(15, 61, 62, 0.32)',
        },
      },
      grid: {
        vertLines: { color: 'rgba(15, 61, 62, 0.06)' },
        horzLines: { color: 'rgba(15, 61, 62, 0.06)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        rightOffset: 4,
        minBarSpacing: 2,
        lockVisibleTimeRangeOnResize: true,
        /** 滾輪縮放時釘住右緣，只改變左邊看得到的歷史 K 線 */
        rightBarStaysOnScroll: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      crosshair: {
        vertLine: {
          color: 'rgba(15, 61, 62, 0.25)',
          labelBackgroundColor: '#0F3D3E',
        },
        horzLine: {
          color: 'rgba(15, 61, 62, 0.25)',
          labelBackgroundColor: '#0F3D3E',
        },
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    chart.panes()[0]?.setStretchFactor(3.2)

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    markerApiRef.current = createSeriesMarkers(candleSeries, [])

    const onRange = (range: LogicalRange | null) => {
      if (!range || applyingRangeRef.current) return
      const prev = savedRangeRef.current
      const span = range.to - range.from
      spanRef.current = span
      savedRangeRef.current = range
      userAdjustedRef.current = true
      if (!prev) return
      const zoomed = Math.abs(span - (prev.to - prev.from)) > 0.2
      if (!zoomed) return
      const count = candleCountRef.current
      if (count < 2) return
      const to = count + RIGHT_PAD
      if (Math.abs(range.to - to) < 0.4) return
      pinLatest(chart, count, span, applyingRangeRef, savedRangeRef)
    }
    const onCrosshair = (param: MouseEventParams<Time>) => {
      const point = param.point
      const time = param.time
      if (
        point == null ||
        time == null ||
        point.x < 0 ||
        point.y < 0 ||
        !candlesRef.current.some((candle) => candle.time === String(time))
      ) {
        setHoverTime((prev) => (prev == null ? prev : null))
        return
      }
      const next = String(time)
      setHoverTime((prev) => (prev === next ? prev : next))
    }
    chart.subscribeCrosshairMove(onCrosshair)
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      markerApiRef.current = null
      overlaySeriesRef.current = []
    }
  }, [])

  const clearOverlays = (chart: IChartApi) => {
    for (const s of overlaySeriesRef.current) {
      try {
        chart.removeSeries(s)
      } catch {
        // ignore
      }
    }
    overlaySeriesRef.current = []
    const panes = chart.panes()
    for (let i = panes.length - 1; i >= 1; i--) {
      try {
        chart.removePane(i)
      } catch {
        // ignore
      }
    }
    chart.panes()[0]?.setStretchFactor(3.2)
  }

  const buildOverlays = (
    chart: IChartApi,
    data: Candle[],
    ind: IndicatorSettings,
  ) => {
    clearOverlays(chart)
    const created: AnySeries[] = []

    const addMainLine = (
      points: { time: string; value: number }[],
      color: string,
      width = 2,
    ) => {
      if (!points.length) return
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: width as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      s.setData(toLineData(points))
      created.push(s)
    }

    if (ind.ma5) addMainLine(calcMA(data, 5), '#E8A838', 2)
    if (ind.ma20) addMainLine(calcMA(data, 20), '#2F6FED', 2)
    if (ind.ma60) addMainLine(calcMA(data, 60), '#8B5E3C', 2)
    if (ind.ema12) addMainLine(calcEMA(data, 12), '#0F3D3E', 2)
    if (ind.ema26) addMainLine(calcEMA(data, 26), '#7A8B99', 2)
    if (ind.bb) {
      const bb = calcBollinger(data)
      addMainLine(bb.upper, 'rgba(15,61,62,0.35)', 1)
      addMainLine(bb.middle, 'rgba(15,61,62,0.55)', 1)
      addMainLine(bb.lower, 'rgba(15,61,62,0.35)', 1)
    }

    if (ind.rsi) {
      const rsi = calcRSI(data)
      if (rsi.length) {
        const pane = addOscillatorPane(chart, 'RSI')
        const s = pane.addSeries(LineSeries, {
          color: '#B86B2D',
          lineWidth: 2,
          priceLineVisible: false,
        })
        s.setData(toLineData(rsi))
        created.push(s)
      }
    }

    if (ind.macd) {
      const macd = calcMACD(data)
      if (macd.macd.length) {
        const pane = addOscillatorPane(chart, 'MACD')
        const hist = pane.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
        })
        hist.setData(
          macd.hist.map((p) => ({
            time: p.time as Time,
            value: p.value,
            color:
              p.value >= 0
                ? 'rgba(196, 92, 74, 0.55)'
                : 'rgba(31, 122, 108, 0.55)',
          })),
        )
        const m = pane.addSeries(LineSeries, {
          color: '#0F3D3E',
          lineWidth: 2,
          priceLineVisible: false,
        })
        const sig = pane.addSeries(LineSeries, {
          color: '#E8A838',
          lineWidth: 2,
          priceLineVisible: false,
        })
        m.setData(toLineData(macd.macd))
        sig.setData(toLineData(macd.signal))
        created.push(hist, m, sig)
      }
    }

    if (ind.kd) {
      const kd = calcKD(data)
      if (kd.k.length) {
        const pane = addOscillatorPane(chart, 'KD')
        const k = pane.addSeries(LineSeries, {
          color: '#2F6FED',
          lineWidth: 2,
          priceLineVisible: false,
        })
        const d = pane.addSeries(LineSeries, {
          color: '#E8A838',
          lineWidth: 2,
          priceLineVisible: false,
        })
        k.setData(toLineData(kd.k))
        d.setData(toLineData(kd.d))
        created.push(k, d)
      }
    }

    overlaySeriesRef.current = created
  }

  const refreshOverlayData = (data: Candle[], ind: IndicatorSettings) => {
    const series = overlaySeriesRef.current
    let i = 0
    const take = () => series[i++]

    const setLine = (points: { time: string; value: number }[]) => {
      const s = take()
      if (s && points.length) s.setData(toLineData(points))
    }

    if (ind.ma5) setLine(calcMA(data, 5))
    if (ind.ma20) setLine(calcMA(data, 20))
    if (ind.ma60) setLine(calcMA(data, 60))
    if (ind.ema12) setLine(calcEMA(data, 12))
    if (ind.ema26) setLine(calcEMA(data, 26))
    if (ind.bb) {
      const bb = calcBollinger(data)
      setLine(bb.upper)
      setLine(bb.middle)
      setLine(bb.lower)
    }
    if (ind.rsi) setLine(calcRSI(data))
    if (ind.macd) {
      const macd = calcMACD(data)
      const hist = take()
      if (hist) {
        hist.setData(
          macd.hist.map((p) => ({
            time: p.time as Time,
            value: p.value,
            color:
              p.value >= 0
                ? 'rgba(196, 92, 74, 0.55)'
                : 'rgba(31, 122, 108, 0.55)',
          })),
        )
      }
      setLine(macd.macd)
      setLine(macd.signal)
    }
    if (ind.kd) {
      const kd = calcKD(data)
      setLine(kd.k)
      setLine(kd.d)
    }
  }

  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!chart || !candleSeries || !volumeSeries || candles.length < 2) return

    const identity = `${candles[0]?.time ?? ''}|${candles[1]?.time ?? ''}`
    const isNewSeries = identity !== dataIdentityRef.current
    if (isNewSeries) {
      dataIdentityRef.current = identity
      userAdjustedRef.current = false
      savedRangeRef.current = null
      spanRef.current = null
    }

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color:
          c.close >= c.open
            ? 'rgba(196, 92, 74, 0.35)'
            : 'rgba(31, 122, 108, 0.35)',
      })),
    )

    const nextIndKey = indicatorKey(indicators)
    if (isNewSeries || nextIndKey !== indicatorKeyRef.current) {
      indicatorKeyRef.current = nextIndKey
      buildOverlays(chart, candles, indicators)
    } else {
      refreshOverlayData(candles, indicators)
    }

    const markers: {
      time: Time
      position: 'belowBar' | 'aboveBar'
      color: string
      shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
      text: string
    }[] = trades.map((t) => {
      const isBuyLike = t.side === 'buy' || t.side === 'cover'
      return {
        time: candles[t.candleIndex]?.time as Time,
        position: isBuyLike ? ('belowBar' as const) : ('aboveBar' as const),
        color: isBuyLike ? UP : DOWN,
        shape: isBuyLike ? ('arrowUp' as const) : ('arrowDown' as const),
        text:
          t.side === 'buy'
            ? '買'
            : t.side === 'cover'
              ? '補'
              : t.side === 'short'
                ? '空'
                : '賣',
      }
    })
    if (markerIndex != null && candles[markerIndex]) {
      markers.push({
        time: candles[markerIndex].time as Time,
        position: 'aboveBar',
        color: '#E8A838',
        shape: 'arrowDown',
        text: '事件',
      })
    }

    const deductions = calcMADeductions(
      candles,
      MA_SPECS.filter((s) => !s.ema && indicators[s.key]).map(
        ({ period, label, color }) => ({ period, label, color }),
      ),
    )
    // 同一根可能有多條均線扣抵，合併文字避免互相覆蓋
    const byTime = new Map<string, typeof deductions>()
    for (const d of deductions) {
      const list = byTime.get(d.time) ?? []
      list.push(d)
      byTime.set(d.time, list)
    }
    for (const [time, list] of byTime) {
      markers.push({
        time: time as Time,
        position: 'belowBar',
        color: list[0].color,
        shape: 'circle',
        text: list.map((d) => `${d.period}扣`).join(' '),
      })
    }

    markerApiRef.current?.setMarkers(markers.filter((m) => m.time))

    candleCountRef.current = candles.length
    const span =
      !isNewSeries && userAdjustedRef.current && spanRef.current
        ? spanRef.current
        : Math.min(DEFAULT_VISIBLE, candles.length) + RIGHT_PAD
    pinLatest(chart, candles.length, span, applyingRangeRef, savedRangeRef)
  }, [candles, indicators, trades, markerIndex])

  const quote =
    candles.find((candle) => candle.time === hoverTime) ??
    candles[candles.length - 1]
  const quoteUp = quote ? quote.close >= quote.open : true
  const averageMaps = useMemo(
    () =>
      MA_SPECS.filter((spec) => indicators[spec.key]).map((spec) => {
        const points = spec.ema
          ? calcEMA(candles, spec.period)
          : calcMA(candles, spec.period)
        return {
          label: spec.label,
          color: spec.color,
          byTime: new Map(points.map((point) => [point.time, point.value])),
        }
      }),
    [candles, indicators],
  )
  const averageQuotes = quote
    ? averageMaps.flatMap((series) => {
        const value = series.byTime.get(quote.time)
        return value == null
          ? []
          : [{ label: series.label, color: series.color, value }]
      })
    : []

  return (
    <div className="chart-stage">
      {quote && (
        <div className="ohlc-legend" aria-live="polite">
          <div className="ohlc-row">
            <span className="date">{quote.time}</span>
            <span>開盤 {formatNumber(quote.open)}</span>
            <span>最高 {formatNumber(quote.high)}</span>
            <span>最低 {formatNumber(quote.low)}</span>
            <span className={quoteUp ? 'up' : 'down'}>
              收盤 {formatNumber(quote.close)}
            </span>
            <span>成交量 {formatNumber(quote.volume, 0)}</span>
          </div>
          {averageQuotes.length > 0 && (
            <div className="ma-row">
              {averageQuotes.map((item) => (
                <span key={item.label} style={{ color: item.color }}>
                  {item.label} {formatNumber(item.value)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="chart-canvas" ref={containerRef} />
    </div>
  )
}

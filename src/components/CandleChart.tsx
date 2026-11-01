import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { Candle, IndicatorSettings, Trade } from '../types'
import {
  calcBollinger,
  calcEMA,
  calcKD,
  calcMA,
  calcMACD,
  calcRSI,
} from '../lib/indicators'

type Props = {
  candles: Candle[]
  indicators: IndicatorSettings
  trades: Trade[]
  markerIndex?: number | null
}

export function CandleChart({
  candles,
  indicators,
  trades,
  markerIndex,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#3d4f4f',
        fontFamily: 'Instrument Sans, Noto Sans TC, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(15, 61, 62, 0.06)' },
        horzLines: { color: 'rgba(15, 61, 62, 0.06)' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(15, 61, 62, 0.25)', labelBackgroundColor: '#0F3D3E' },
        horzLine: { color: 'rgba(15, 61, 62, 0.25)', labelBackgroundColor: '#0F3D3E' },
      },
    })
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#1F7A6C',
      downColor: '#C45C4A',
      borderUpColor: '#1F7A6C',
      borderDownColor: '#C45C4A',
      wickUpColor: '#1F7A6C',
      wickDownColor: '#C45C4A',
    })

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color:
          c.close >= c.open
            ? 'rgba(31, 122, 108, 0.35)'
            : 'rgba(196, 92, 74, 0.35)',
      })),
    )

    const overlays: ISeriesApi<'Line'>[] = []
    const addLine = (data: { time: string; value: number }[], color: string, width = 2) => {
      if (!data.length) return
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: width as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })))
      overlays.push(s)
    }

    if (indicators.ma5) addLine(calcMA(candles, 5), '#E8A838', 2)
    if (indicators.ma20) addLine(calcMA(candles, 20), '#2F6FED', 2)
    if (indicators.ma60) addLine(calcMA(candles, 60), '#8B5E3C', 2)
    if (indicators.ema12) addLine(calcEMA(candles, 12), '#0F3D3E', 2)
    if (indicators.ema26) addLine(calcEMA(candles, 26), '#7A8B99', 2)
    if (indicators.bb) {
      const bb = calcBollinger(candles)
      addLine(bb.upper, 'rgba(15,61,62,0.35)', 1)
      addLine(bb.middle, 'rgba(15,61,62,0.55)', 1)
      addLine(bb.lower, 'rgba(15,61,62,0.35)', 1)
    }

    // Sub-pane indicators via separate price scales squeezed at bottom
    if (indicators.rsi) {
      const rsi = calcRSI(candles)
      const s = chart.addSeries(LineSeries, {
        color: '#B86B2D',
        lineWidth: 2,
        priceScaleId: 'rsi',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      chart.priceScale('rsi').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      })
      s.setData(rsi.map((p) => ({ time: p.time as Time, value: p.value })))
      overlays.push(s)
    }

    if (indicators.macd) {
      const macd = calcMACD(candles)
      const m = chart.addSeries(LineSeries, {
        color: '#0F3D3E',
        lineWidth: 2,
        priceScaleId: 'macd',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      const sig = chart.addSeries(LineSeries, {
        color: '#C45C4A',
        lineWidth: 2,
        priceScaleId: 'macd',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      chart.priceScale('macd').applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      })
      m.setData(macd.macd.map((p) => ({ time: p.time as Time, value: p.value })))
      sig.setData(macd.signal.map((p) => ({ time: p.time as Time, value: p.value })))
      overlays.push(m, sig)
    }

    if (indicators.kd) {
      const kd = calcKD(candles)
      const k = chart.addSeries(LineSeries, {
        color: '#1F7A6C',
        lineWidth: 2,
        priceScaleId: 'kd',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      const d = chart.addSeries(LineSeries, {
        color: '#C45C4A',
        lineWidth: 2,
        priceScaleId: 'kd',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      chart.priceScale('kd').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      })
      k.setData(kd.k.map((p) => ({ time: p.time as Time, value: p.value })))
      d.setData(kd.d.map((p) => ({ time: p.time as Time, value: p.value })))
      overlays.push(k, d)
    }

    const markers = trades.map((t) => ({
      time: candles[t.candleIndex]?.time as Time,
      position: t.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
      color: t.side === 'buy' ? '#1F7A6C' : '#C45C4A',
      shape: t.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
      text: t.side === 'buy' ? '買' : '賣',
    }))

    if (markerIndex != null && candles[markerIndex]) {
      markers.push({
        time: candles[markerIndex].time as Time,
        position: 'aboveBar' as const,
        color: '#E8A838',
        shape: 'arrowDown' as const,
        text: '事件',
      })
    }

    createSeriesMarkers(
      candleSeries,
      markers.filter((m) => m.time),
    )

    chart.timeScale().fitContent()

    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [candles, indicators, trades, markerIndex])

  return <div className="chart-canvas" ref={containerRef} />
}

import type { Candle } from '../types'

export type LinePoint = { time: string; value: number }

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function calcMA(candles: Candle[], period: number): LinePoint[] {
  const closes = candles.map((c) => c.close)
  const series = sma(closes, period)
  return candles
    .map((c, i) =>
      series[i] == null ? null : { time: c.time, value: series[i] as number },
    )
    .filter((p): p is LinePoint => p != null)
}

export function calcEMA(candles: Candle[], period: number): LinePoint[] {
  const closes = candles.map((c) => c.close)
  const series = ema(closes, period)
  return candles
    .map((c, i) =>
      series[i] == null ? null : { time: c.time, value: series[i] as number },
    )
    .filter((p): p is LinePoint => p != null)
}

export function calcBollinger(candles: Candle[], period = 20, mult = 2) {
  const closes = candles.map((c) => c.close)
  const mid = sma(closes, period)
  const upper: LinePoint[] = []
  const middle: LinePoint[] = []
  const lower: LinePoint[] = []

  for (let i = 0; i < candles.length; i++) {
    if (mid[i] == null) continue
    const slice = closes.slice(i - period + 1, i + 1)
    const mean = mid[i] as number
    const variance =
      slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    middle.push({ time: candles[i].time, value: mean })
    upper.push({ time: candles[i].time, value: mean + mult * std })
    lower.push({ time: candles[i].time, value: mean - mult * std })
  }
  return { upper, middle, lower }
}

export function calcRSI(candles: Candle[], period = 14): LinePoint[] {
  const closes = candles.map((c) => c.close)
  const out: LinePoint[] = []
  if (closes.length <= period) return out

  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  const rsi0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  out.push({ time: candles[period].time, value: rsi0 })

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const g = diff > 0 ? diff : 0
    const l = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    out.push({ time: candles[i].time, value })
  }
  return out
}

export function calcMACD(candles: Candle[]) {
  const closes = candles.map((c) => c.close)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macdRaw: (number | null)[] = closes.map((_, i) =>
    ema12[i] == null || ema26[i] == null
      ? null
      : (ema12[i] as number) - (ema26[i] as number),
  )
  const macdVals = macdRaw.map((v) => v ?? 0)
  // signal on valid macd only — approximate with ema of full series after first valid
  const first = macdRaw.findIndex((v) => v != null)
  const signalSeries = ema(
    macdVals.map((v, i) => (i < first ? 0 : v)),
    9,
  )

  const macd: LinePoint[] = []
  const signal: LinePoint[] = []
  const hist: LinePoint[] = []

  for (let i = 0; i < candles.length; i++) {
    if (macdRaw[i] == null || signalSeries[i] == null) continue
    const m = macdRaw[i] as number
    const s = signalSeries[i] as number
    macd.push({ time: candles[i].time, value: m })
    signal.push({ time: candles[i].time, value: s })
    hist.push({ time: candles[i].time, value: m - s })
  }
  return { macd, signal, hist }
}

export function calcKD(candles: Candle[], period = 9) {
  const k: LinePoint[] = []
  const d: LinePoint[] = []
  let prevK = 50
  let prevD = 50

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue
    const window = candles.slice(i - period + 1, i + 1)
    const highest = Math.max(...window.map((c) => c.high))
    const lowest = Math.min(...window.map((c) => c.low))
    const rsv =
      highest === lowest
        ? 50
        : ((candles[i].close - lowest) / (highest - lowest)) * 100
    prevK = (2 / 3) * prevK + (1 / 3) * rsv
    prevD = (2 / 3) * prevD + (1 / 3) * prevK
    k.push({ time: candles[i].time, value: prevK })
    d.push({ time: candles[i].time, value: prevD })
  }
  return { k, d }
}

import { fetchJson } from './http.js'
import type { IndicatorSeries, SeriesPoint } from './types.js'

type HistockDayK = {
  Data?: string
  data?: string
}

function parseDayK(payload: HistockDayK): SeriesPoint[] {
  const raw = payload.Data || payload.data || '[]'
  // Histock sometimes leaves a trailing comma before ]
  const cleaned = raw.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}')
  const rows = JSON.parse(cleaned) as number[][]
  return rows
    .map((row) => {
      const ts = row[0]
      const close = row[4] ?? row[1]
      const date = new Date(ts).toISOString().slice(0, 10)
      return { date, value: Number(close) }
    })
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchBdi(): Promise<IndicatorSeries> {
  const payload = await fetchJson<HistockDayK>(
    'https://histock.tw/stock/module/stockdata.aspx?no=BDI&m=DayK',
    {
      headers: {
        Referer: 'https://histock.tw/index/BDI',
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  )

  const series = parseDayK(payload)
  const latest = series.at(-1) ?? null
  const prev = series.at(-2)
  const change =
    latest && prev ? Number((latest.value - prev.value).toFixed(2)) : null

  return {
    id: 'bdi',
    title: '波羅的海乾散貨指數（BDI）',
    unit: '指數',
    frequency: 'daily',
    latest,
    change,
    note: '全球乾散貨航運運價綜合指標',
    source: 'HiStock（BDI 日線）',
    series,
  }
}

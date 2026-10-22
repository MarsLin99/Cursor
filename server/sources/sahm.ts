import { fetchJson } from './http.js'
import type { IndicatorSeries, SeriesPoint } from './types.js'

type BlsResponse = {
  status: string
  Results?: {
    series?: Array<{
      data?: Array<{ year: string; period: string; value: string }>
    }>
  }
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** Sahm Rule = 3mma(u) − min(3mma over prior 12 months) */
function computeSahm(unemp: SeriesPoint[]): SeriesPoint[] {
  const sorted = [...unemp].sort((a, b) => a.date.localeCompare(b.date))
  const values = sorted.map((p) => p.value)
  const dates = sorted.map((p) => p.date)
  const ma3: Array<number | null> = values.map((_, i) => {
    if (i < 2) return null
    return avg(values.slice(i - 2, i + 1))
  })

  const out: SeriesPoint[] = []
  for (let i = 0; i < ma3.length; i++) {
    const current = ma3[i]
    if (current == null) continue
    const window = ma3.slice(Math.max(0, i - 12), i).filter((v): v is number => v != null)
    if (window.length === 0) continue
    const trough = Math.min(...window)
    out.push({
      date: dates[i],
      value: Number((current - trough).toFixed(3)),
    })
  }
  return out
}

export async function fetchSahm(): Promise<IndicatorSeries> {
  const end = new Date().getFullYear()
  const start = end - 5
  const body = {
    seriesid: ['LNS14000000'],
    startyear: String(start),
    endyear: String(end),
  }

  const data = await fetchJson<BlsResponse>(
    'https://api.bls.gov/publicAPI/v2/timeseries/data/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  if (data.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS 回應失敗：${data.status}`)
  }

  const rows = data.Results?.series?.[0]?.data || []
  const unemp: SeriesPoint[] = rows
    .filter((r) => r.period.startsWith('M') && r.value !== '-')
    .map((r) => ({
      date: `${r.year}-${r.period.slice(1)}-01`,
      value: Number(r.value),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const series = computeSahm(unemp)
  const latest = series.at(-1) ?? null
  const prev = series.at(-2)
  const change =
    latest && prev ? Number((latest.value - prev.value).toFixed(3)) : null

  return {
    id: 'sahm',
    title: '薩姆規則衰退指標',
    unit: '百分點',
    frequency: 'monthly',
    latest,
    change,
    note: '≥ 0.5 視為觸發衰退訊號（即時版，以 BLS 失業率推算）',
    source: '美國勞工統計局 BLS（失业率 LNS14000000）自行計算',
    series,
    meta: {
      threshold: 0.5,
      unemploymentLatest: unemp.at(-1)?.value ?? null,
    },
  }
}

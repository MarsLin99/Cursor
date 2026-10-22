import { fetchJson } from './http.js'
import type { StockSummary } from './types.js'

type Fmtqik = {
  stat?: string
  fields?: string[]
  data?: string[][]
}

function rocToIso(roc: string): string {
  // 115/10/21
  const [y, m, d] = roc.split('/')
  return `${Number(y) + 1911}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function num(s: string): number {
  return Number(String(s).replace(/,/g, ''))
}

function monthCandidates(count = 3): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    out.push(`${y}${m}01`)
  }
  return out
}

export async function fetchTwseSummary(): Promise<StockSummary | null> {
  let best: string[] | null = null

  for (const date of monthCandidates(4)) {
    try {
      const json = await fetchJson<Fmtqik>(
        `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=${date}`,
      )
      if (json.stat !== 'OK' || !json.data?.length) continue
      const last = json.data[json.data.length - 1]
      if (!best || rocToIso(last[0]) > rocToIso(best[0])) {
        best = last
      }
    } catch {
      // try older months
    }
  }

  if (!best) return null

  const index = num(best[4])
  const change = num(best[5])
  const prev = index - change
  const changePercent = prev ? Number(((change / prev) * 100).toFixed(2)) : null

  const sign = change > 0 ? '+' : ''
  const pct =
    changePercent == null ? '' : ` / ${sign}${changePercent.toFixed(2)}%`

  return {
    date: rocToIso(best[0]),
    index,
    change,
    changePercent,
    volumeShares: num(best[1]),
    turnoverTwd: num(best[2]),
    trades: num(best[3]),
    source: '臺灣證券交易所 TWSE',
    note: `加權指數收盤 ${index.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}（${sign}${change.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}${pct}）`,
  }
}

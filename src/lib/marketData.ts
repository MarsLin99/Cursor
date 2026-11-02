import type { Candle, StockSeries } from '../types'

const STOCK_NAMES: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2454': '聯發科',
  '2308': '台達電',
  '2881': '富邦金',
  '2882': '國泰金',
  '2303': '聯電',
  '2412': '中華電',
  '1301': '台塑',
  '2002': '中鋼',
  '2603': '長榮',
  '3037': '欣興',
  '3711': '日月光投控',
  '2382': '廣達',
  '2357': '華碩',
}

function rocToIso(rocDate: string): string {
  // 113/10/01 -> 2024-10-01
  const [y, m, d] = rocDate.split('/')
  const year = Number(y) + 1911
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function parseTwseNumber(raw: string): number {
  return Number(String(raw).replace(/,/g, ''))
}

function monthKeys(monthsBack: number): string[] {
  const keys: string[] = []
  const now = new Date()
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    keys.push(`${y}${m}01`)
  }
  return keys
}

async function fetchTwseMonth(
  stockNo: string,
  dateKey: string,
): Promise<Candle[]> {
  const url = `/api/twse/rwd/zh/afterTrading/STOCK_DAY?date=${dateKey}&stockNo=${stockNo}&response=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`)
  const json = (await res.json()) as {
    stat: string
    title?: string
    data?: string[][]
  }
  if (json.stat !== 'OK' || !json.data) return []

  return json.data
    .map((row) => {
      const time = rocToIso(row[0])
      const open = parseTwseNumber(row[3])
      const high = parseTwseNumber(row[4])
      const low = parseTwseNumber(row[5])
      const close = parseTwseNumber(row[6])
      const volume = parseTwseNumber(row[1])
      if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) {
        return null
      }
      return {
        time,
        timestamp: Date.parse(`${time}T00:00:00+08:00`),
        open,
        high,
        low,
        close,
        volume,
      } satisfies Candle
    })
    .filter((c): c is Candle => c != null)
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildDemoSeries(symbol: string, name: string): StockSeries {
  const rand = mulberry32(
    [...symbol].reduce((a, c) => a + c.charCodeAt(0) * 17, 2330),
  )
  const candles: Candle[] = []
  let price = 100 + rand() * 400
  const start = new Date()
  start.setDate(start.getDate() - 1600)

  for (let i = 0; i < 1300; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    const drift = (rand() - 0.48) * 0.03
    const open = price
    const close = Math.max(5, open * (1 + drift))
    const high = Math.max(open, close) * (1 + rand() * 0.012)
    const low = Math.min(open, close) * (1 - rand() * 0.012)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const time = `${y}-${m}-${day}`
    candles.push({
      time,
      timestamp: Date.parse(`${time}T00:00:00+08:00`),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.floor(5_000_000 + rand() * 40_000_000),
    })
    price = close
  }

  return { symbol, name: `${name}（示範資料）`, source: 'demo', candles }
}

async function fetchTwseMonths(
  stockNo: string,
  monthsBack: number,
): Promise<{ candles: Candle[]; okMonths: number }> {
  const keys = monthKeys(monthsBack)
  const chunks: Candle[] = []
  let okMonths = 0
  const batchSize = 8
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize)
    await Promise.all(
      batch.map(async (key) => {
        try {
          const month = await fetchTwseMonth(stockNo, key)
          if (month.length) {
            chunks.push(...month)
            okMonths += 1
          }
        } catch {
          // ignore single-month failures
        }
      }),
    )
  }
  const byDay = new Map<string, Candle>()
  for (const c of chunks) byDay.set(c.time, c)
  const candles = [...byDay.values()].sort((a, b) => a.time.localeCompare(b.time))
  return { candles, okMonths }
}

async function fetchYahoo(symbol: string): Promise<StockSeries | null> {
  const coded = symbol.includes('.') ? symbol : `${symbol}.TW`
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(coded)}?interval=1d&range=5y`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return null
    const quotes = result.indicators?.quote?.[0]
    const ts: number[] = result.timestamp ?? []
    const candles: Candle[] = []
    for (let i = 0; i < ts.length; i++) {
      const open = quotes.open?.[i]
      const high = quotes.high?.[i]
      const low = quotes.low?.[i]
      const close = quotes.close?.[i]
      const volume = quotes.volume?.[i] ?? 0
      if (![open, high, low, close].every((n: number) => Number.isFinite(n))) {
        continue
      }
      const date = new Date(ts[i] * 1000)
      const y = date.getUTCFullYear()
      const m = String(date.getUTCMonth() + 1).padStart(2, '0')
      const d = String(date.getUTCDate()).padStart(2, '0')
      candles.push({
        time: `${y}-${m}-${d}`,
        timestamp: ts[i] * 1000,
        open,
        high,
        low,
        close,
        volume,
      })
    }
    if (candles.length < 60) return null
    const metaName = result.meta?.shortName || result.meta?.symbol || coded
    return {
      symbol: coded.replace('.TW', ''),
      name: metaName,
      source: 'yahoo',
      candles,
    }
  } catch {
    return null
  }
}

export function normalizeSymbol(input: string): string {
  return input.trim().toUpperCase().replace(/\.TW$/i, '').replace(/\s+/g, '')
}

export async function loadStockSeries(rawSymbol: string): Promise<StockSeries> {
  const symbol = normalizeSymbol(rawSymbol)
  if (!/^\d{4,6}$/.test(symbol) && !/^[A-Z.]{1,10}$/.test(symbol)) {
    throw new Error('請輸入台股代號，例如 2330、2317')
  }

  // Prefer TWSE for numeric Taiwan tickers（約五年日 K）
  if (/^\d{4}$/.test(symbol)) {
    const { candles, okMonths } = await fetchTwseMonths(symbol, 60)

    if (candles.length >= 80 && okMonths >= 3) {
      return {
        symbol,
        name: STOCK_NAMES[symbol] ?? `代號 ${symbol}`,
        source: 'twse',
        candles,
      }
    }

    const yahoo = await fetchYahoo(symbol)
    if (yahoo) {
      yahoo.name = STOCK_NAMES[symbol] ?? yahoo.name
      return yahoo
    }

    return buildDemoSeries(symbol, STOCK_NAMES[symbol] ?? `代號 ${symbol}`)
  }

  const yahoo = await fetchYahoo(symbol)
  if (yahoo) return yahoo
  return buildDemoSeries(symbol, symbol)
}

export const SUGGESTED_SYMBOLS = [
  { symbol: '2330', name: '台積電' },
  { symbol: '2317', name: '鴻海' },
  { symbol: '2454', name: '聯發科' },
  { symbol: '2308', name: '台達電' },
  { symbol: '2881', name: '富邦金' },
  { symbol: '2603', name: '長榮' },
]

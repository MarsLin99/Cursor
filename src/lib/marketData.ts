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

/** 例如「115年11月 2385 群光             各日成交資訊」 */
function parseTwseName(title?: string): string | undefined {
  if (!title) return
  const matched = title.match(/(\d{4,6}[A-Z]?)\s+(.+?)\s+各日成交資訊/)
  const name = matched?.[2]?.trim()
  return name || undefined
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchTwseMonth(
  stockNo: string,
  dateKey: string,
  attempt = 0,
  signal?: AbortSignal,
): Promise<{ candles: Candle[]; name?: string }> {
  const bust = attempt > 0 ? `&_=${Date.now()}-${attempt}` : ''
  const url = `/api/twse/rwd/zh/afterTrading/STOCK_DAY?date=${dateKey}&stockNo=${stockNo}&response=json${bust}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`)
  const json = (await res.json()) as {
    stat: string
    title?: string
    data?: string[][]
  }
  if (json.stat !== 'OK' || !json.data) return { candles: [] }
  const name = parseTwseName(json.title)

  return {
    name,
    candles: json.data
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
    .filter((c): c is Candle => c != null),
  }
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

function mergeCandles(chunks: Candle[]): Candle[] {
  const byDay = new Map<string, Candle>()
  for (const candle of chunks) byDay.set(candle.time, candle)
  return [...byDay.values()].sort((a, b) => a.time.localeCompare(b.time))
}

function calendarDaysBetween(earlier: string, later: string): number {
  const ms =
    Date.parse(`${later}T00:00:00+08:00`) -
    Date.parse(`${earlier}T00:00:00+08:00`)
  return Math.round(ms / 86_400_000)
}

/** 農曆年假大約十天；比這更長的空洞視為該月沒抓到 */
function monthsCoveringGaps(candles: Candle[], minGapDays = 18): string[] {
  const keys = new Set<string>()
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].time
    const next = candles[i].time
    if (calendarDaysBetween(prev, next) <= minGapDays) continue
    const cursor = new Date(`${prev}T00:00:00+08:00`)
    const end = new Date(`${next}T00:00:00+08:00`)
    cursor.setDate(1)
    while (cursor <= end) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      keys.add(`${y}${m}01`)
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }
  return [...keys]
}

async function fetchTwseMonthRetry(
  stockNo: string,
  dateKey: string,
  signal?: AbortSignal,
): Promise<{ candles: Candle[]; name?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) break
    if (attempt > 0) await delay(300)
    try {
      return await fetchTwseMonth(stockNo, dateKey, attempt, signal)
    } catch {
      // 證交所流量過大時會回安全性頁面，或這次請求已取消
    }
  }
  return { candles: [] }
}

async function fetchTwseMonths(
  stockNo: string,
  monthsBack: number,
  signal?: AbortSignal,
): Promise<{ candles: Candle[]; okMonths: number; name?: string }> {
  const keys = monthKeys(monthsBack)
  const chunks: Candle[] = []
  let name: string | undefined
  let nameKey = ''
  const concurrency = 2

  const takeMonth = async (key: string) => {
    const month = await fetchTwseMonthRetry(stockNo, key, signal)
    if (month.candles.length) chunks.push(...month.candles)
    if (month.name && key >= nameKey) {
      name = month.name
      nameKey = key
    }
  }

  let cursor = 0
  async function worker() {
    while (cursor < keys.length) {
      if (signal?.aborted) return
      const key = keys[cursor]
      cursor += 1
      await takeMonth(key)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()),
  )

  let candles = mergeCandles(chunks)
  if (!signal?.aborted) {
    const gapKeys = monthsCoveringGaps(candles).filter((key) =>
      keys.includes(key),
    )
    for (const key of gapKeys) {
      if (signal?.aborted) break
      await takeMonth(key)
    }
    candles = mergeCandles(chunks)
  }
  const okMonths = new Set(candles.map((candle) => candle.time.slice(0, 7))).size
  return { candles, okMonths, name }
}

function usableQuoteName(name: string | undefined, symbol: string): string | undefined {
  const trimmed = name?.trim()
  if (!trimmed) return
  const compact = trimmed.toUpperCase().replace(/\s/g, '')
  if (
    compact === symbol ||
    compact === `${symbol}.TW` ||
    compact === `${symbol}.TWO`
  ) {
    return
  }
  return trimmed
}

async function fetchYahoo(
  symbol: string,
  suffix: '.TW' | '.TWO' = '.TW',
): Promise<StockSeries | null> {
  const coded = symbol.includes('.') ? symbol : `${symbol}${suffix}`
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(coded)}?interval=1d&range=5y`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
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
    const quoteSymbol = coded.replace(/\.TWO$/, '').replace(/\.TW$/, '')
    return {
      symbol: quoteSymbol,
      name:
        usableQuoteName(result.meta?.shortName, quoteSymbol) ||
        usableQuoteName(result.meta?.longName, quoteSymbol) ||
        '',
      source: 'yahoo',
      candles,
    }
  } catch {
    return null
  }
}

export type StockMarket = 'twse' | 'tpex'

export type StockHit = {
  symbol: string
  name: string
  fullName?: string
  market: StockMarket
}

type TwseDayRow = { Code?: string; Name?: string }
type TwseCompanyRow = {
  公司代號?: string
  公司簡稱?: string
  公司名稱?: string
}
type TpexQuoteRow = {
  SecuritiesCompanyCode?: string
  CompanyName?: string
}

let directoryTask: Promise<StockHit[]> | null = null

function compactCompanyName(name: string): string {
  return name.replace(/股份有限公司|有限公司/g, '').replace(/\s+/g, '')
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

async function fetchDirectory(): Promise<StockHit[]> {
  const [dayAll, companies, tpex] = await Promise.allSettled([
    fetchJson<TwseDayRow[]>('/api/listed/v1/exchangeReport/STOCK_DAY_ALL'),
    fetchJson<TwseCompanyRow[]>('/api/listed/v1/opendata/t187ap03_L'),
    fetchJson<TpexQuoteRow[]>('/api/tpex/openapi/v1/tpex_mainboard_quotes'),
  ])
  const map = new Map<string, StockHit>()

  if (dayAll.status === 'fulfilled') {
    for (const row of dayAll.value) {
      const symbol = row.Code?.trim()
      const name = row.Name?.trim()
      if (!symbol || !name) continue
      map.set(symbol, { symbol, name, market: 'twse' })
    }
  }

  if (companies.status === 'fulfilled') {
    for (const row of companies.value) {
      const symbol = row.公司代號?.trim()
      const name = row.公司簡稱?.trim()
      const fullName = row.公司名稱?.trim()
      if (!symbol || !name) continue
      map.set(symbol, { symbol, name, fullName, market: 'twse' })
    }
  }

  if (tpex.status === 'fulfilled') {
    for (const row of tpex.value) {
      const symbol = row.SecuritiesCompanyCode?.trim()
      const name = row.CompanyName?.trim()
      if (!symbol || !name || map.has(symbol)) continue
      map.set(symbol, { symbol, name, market: 'tpex' })
    }
  }

  if (map.size === 0) throw new Error('股票名單載入失敗')
  return [...map.values()]
}

export function ensureStockDirectory(): Promise<StockHit[]> {
  if (!directoryTask) {
    directoryTask = fetchDirectory().catch((error) => {
      directoryTask = null
      throw error
    })
  }
  return directoryTask
}

function scoreHit(stock: StockHit, query: string): number {
  const q = query.trim()
  const upper = q.toUpperCase()
  const full = stock.fullName ? compactCompanyName(stock.fullName) : ''
  let score = 0
  if (stock.symbol.toUpperCase() === upper) score += 1000
  if (stock.name === q) score += 800
  if (full && full === q) score += 700
  if (q.length >= 2 && stock.name.startsWith(q)) score += 400
  if (q.length >= 2 && full.startsWith(q)) score += 300
  if (q.length >= 2 && stock.name.includes(q)) score += 200
  if (q.length >= 2 && full.includes(q)) score += 100
  if (
    /^\d{2,6}$/.test(upper) &&
    stock.symbol.toUpperCase().startsWith(upper) &&
    stock.symbol.toUpperCase() !== upper
  ) {
    score += 50
  }
  if (score === 0) return 0
  if (/^\d{4,6}$/.test(stock.symbol)) score += 20
  if (stock.market === 'twse') score += 5
  return score
}

function dedupeHits(hits: StockHit[]): StockHit[] {
  const seen = new Set<string>()
  const unique: StockHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.symbol)) continue
    seen.add(hit.symbol)
    unique.push(hit)
  }
  return unique
}

export async function searchStocks(raw: string): Promise<StockHit[]> {
  const query = raw.trim().replace(/\s+/g, '')
  if (!query) return []
  if ([...query].length < 2 && !/^\d+$/.test(query)) return []
  let list: StockHit[] = []
  try {
    list = await ensureStockDirectory()
  } catch {
    return []
  }
  return list
    .map((stock) => ({ stock, score: scoreHit(stock, query) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.stock.symbol.localeCompare(b.stock.symbol),
    )
    .slice(0, 8)
    .map((item) => item.stock)
}

export type StockResolution =
  | { status: 'one'; stock: StockHit }
  | { status: 'many'; stocks: StockHit[] }
  | { status: 'code'; symbol: string }
  | { status: 'none' }

export async function resolveStockQuery(raw: string): Promise<StockResolution> {
  const query = raw.trim().replace(/\s+/g, '')
  if (!query) return { status: 'none' }
  const upper = query.toUpperCase().replace(/\.TWO$/i, '').replace(/\.TW$/i, '')
  const codeLike = /^\d{4,6}[A-Z]?$/.test(upper) || /^[A-Z.]{1,12}$/.test(upper)
  let list: StockHit[] = []
  try {
    list = await ensureStockDirectory()
  } catch {
    list = []
  }

  const ranked = list
    .map((stock) => ({ stock, score: scoreHit(stock, query) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.stock.symbol.localeCompare(b.stock.symbol),
    )
  const exact = dedupeHits(
    ranked
      .filter(
        (item) =>
          item.stock.symbol.toUpperCase() === upper ||
          item.stock.name === query ||
          (item.stock.fullName != null &&
            compactCompanyName(item.stock.fullName) === query),
      )
      .map((item) => item.stock),
  )
  if (exact.length === 1) return { status: 'one', stock: exact[0] }
  if (exact.length > 1) return { status: 'many', stocks: exact.slice(0, 8) }
  if (codeLike) return { status: 'code', symbol: upper }
  if (ranked.length === 1) return { status: 'one', stock: ranked[0].stock }
  if (ranked.length > 1) {
    const best = ranked[0]
    const second = ranked[1]
    if (best.score >= 400 && best.score - second.score >= 100) {
      return { status: 'one', stock: best.stock }
    }
    return {
      status: 'many',
      stocks: dedupeHits(ranked.map((item) => item.stock)).slice(0, 8),
    }
  }
  return { status: 'none' }
}

function pickName(symbol: string, ...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const name = usableQuoteName(candidate, symbol)
    if (name) return name
  }
  return STOCK_NAMES[symbol] ?? ''
}

export function normalizeSymbol(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/\.TWO$/i, '')
    .replace(/\.TW$/i, '')
    .replace(/\s+/g, '')
}

export async function loadStockSeries(
  rawSymbol: string,
  hint?: { name?: string; market?: StockMarket | 'unknown' },
): Promise<StockSeries> {
  const symbol = normalizeSymbol(rawSymbol)
  if (!/^\d{4,6}[A-Z]?$/.test(symbol) && !/^[A-Z.]{1,12}$/.test(symbol)) {
    throw new Error('請輸入台股代號或中文名稱，例如 2385、群光')
  }

  const listed = await ensureStockDirectory()
    .then((list) => list.find((item) => item.symbol === symbol))
    .catch(() => undefined)
  const knownName = hint?.name || listed?.name
  const market =
    hint?.market && hint.market !== 'unknown' ? hint.market : listed?.market

  const suffixes: Array<'.TW' | '.TWO'> =
    market === 'tpex' ? ['.TWO', '.TW'] : ['.TW', '.TWO']
  let yahooFallback: StockSeries | null = null
  for (const suffix of suffixes) {
    const yahoo = await fetchYahoo(symbol, suffix)
    if (!yahoo) continue
    yahoo.symbol = symbol
    yahoo.name = pickName(symbol, knownName, yahoo.name)
    if (!monthsCoveringGaps(yahoo.candles).length) return yahoo
    yahooFallback ??= yahoo
  }

  if (market !== 'tpex' && /^\d{4,6}$/.test(symbol)) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const { candles, okMonths, name } = await fetchTwseMonths(
        symbol,
        60,
        ctrl.signal,
      )
      if (candles.length >= 80 && okMonths >= 3 && !monthsCoveringGaps(candles).length) {
        return {
          symbol,
          name: pickName(symbol, name, knownName),
          source: 'twse',
          candles,
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  if (yahooFallback) return yahooFallback
  return buildDemoSeries(symbol, pickName(symbol, knownName) || symbol)
}

export const SUGGESTED_SYMBOLS = [
  { symbol: '2330', name: '台積電' },
  { symbol: '2317', name: '鴻海' },
  { symbol: '2454', name: '聯發科' },
  { symbol: '2308', name: '台達電' },
  { symbol: '2881', name: '富邦金' },
  { symbol: '2603', name: '長榮' },
]

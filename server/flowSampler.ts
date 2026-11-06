import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 內外盤抽樣（與 OneWebStock 參考程式 record_flow / trade_side / refresh_mis_book 同一套規則）：
 * - 每 ~0.15 秒（加上請求時間）抓一次鉅亨即時報價（成交價、累積量、報價時間）
 * - 每 1.2 秒抓一次證交所 MIS 最佳一檔委買／委賣，4 秒內的才算新鮮
 * - 兩次報價間累積量增加的張數，整筆歸到「報價時間」那一分鐘：
 *   成交價 ≥ 委賣 → 外盤；≤ 委買 → 內盤；否則跟上一次價格比漲跌；再不行沿用上一次方向；都沒有就各半
 * - buildSpark 使用時：該分鐘抽樣總量在一分K量的 0.5～1.5 倍之間才採用，否則用 split_by_close 估
 * 參考程式只放記憶體；這裡每天存到 data/flow-samples.json，重啟不會遺失。
 */

type Market = 'twse' | 'tpex'
type Side = -1 | 0 | 1
type FlowState = { volume: number | null; price: number | null; side: Side }
type BookRow = { bid: number | null; ask: number | null; at: number }
type SampleFile = {
  date: string
  markets: Record<string, Market>
  flow: Record<string, Record<string, [number, number]>>
  state: Record<string, FlowState>
  price: Record<string, number>
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const QUOTE_GAP_MS = 150
const BOOK_GAP_MS = 1200
const BOOK_FRESH_MS = 4000
const KEEP_MS = 10 * 60_000

let file = ''
let samples: SampleFile = emptyFile('')
let dirty = false
let started = false
const books = new Map<string, BookRow>()
const seen = new Map<string, { market: Market; at: number }>()

function emptyFile(date: string): SampleFile {
  return { date, markets: {}, flow: {}, state: {}, price: {} }
}

function num(value: unknown) {
  if (value == null || value === '' || value === '-') return null
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function taipeiParts(ms: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${hour}:${get('minute')}`, weekday: get('weekday') }
}

/** 平日 08:55～14:30（鉅亨報價時間常落後，收盤後多留一段讓最後幾分鐘的量進來） */
function sampling(now = Date.now()) {
  const { hm, weekday } = taipeiParts(now)
  return weekday !== 'Sat' && weekday !== 'Sun' && hm >= '08:55' && hm <= '14:30'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}

const SYMBOL_RE = /^[0-9A-Z]{4,6}$/
const YAHOO_SKIP = new Set(['T00', 'IX0001', 'IR0001'])

function validFlowSymbol(symbol: string) {
  const code = symbol.trim().toUpperCase()
  return SYMBOL_RE.test(code) && !YAHOO_SKIP.has(code) ? code : ''
}

function watched() {
  const now = Date.now()
  for (const [symbol, row] of seen) if (now - row.at > KEEP_MS) seen.delete(symbol)
  // Drop corrupt / non-stock keys so one bad symbol cannot 400 the whole Yahoo poll.
  for (const symbol of Object.keys(samples.markets)) {
    if (!validFlowSymbol(symbol)) {
      delete samples.markets[symbol]
      dirty = true
    }
  }
  const out = new Map<string, Market>()
  for (const [symbol, market] of Object.entries(samples.markets)) {
    const code = validFlowSymbol(symbol)
    if (code) out.set(code, market)
  }
  for (const [symbol, row] of seen) {
    const code = validFlowSymbol(symbol)
    if (code) out.set(code, row.market)
  }
  return out
}

/** 走勢圖要過的代號都抽樣（同參考程式：自選清單上的每一檔） */
export function noteFlowSymbols(items: { symbol: string; market: Market }[]) {
  const now = Date.now()
  let added = false
  for (const raw of items) {
    const symbol = validFlowSymbol(String(raw.symbol ?? ''))
    if (!symbol) continue
    const item = { symbol, market: raw.market === 'tpex' ? 'tpex' as const : 'twse' as const }
    if (!seen.has(item.symbol)) added = true
    seen.set(item.symbol, { market: item.market, at: now })
    if (samples.markets[item.symbol] !== item.market) {
      samples.markets[item.symbol] = item.market
      dirty = true
    }
  }
  // A newly requested symbol must not wait for the next scheduled loop.
  if (added) void pollYahooNow(true)
}

/** trade_side：先比委買委賣，再比上一筆價格，最後沿用上一次方向 */
function tradeSide(price: number | null, prevPrice: number | null, bid: number | null, ask: number | null, last: Side): Side {
  if (price == null) return last || 0
  if (ask != null && ask !== 0 && price >= ask) return 1
  if (bid != null && bid !== 0 && price <= bid) return -1
  if (prevPrice != null && prevPrice !== 0) {
    if (price > prevPrice) return 1
    if (price < prevPrice) return -1
  }
  return last || 0
}

function recordFlow(symbol: string, price: number | null, volume: number | null, quoteTs: number | null) {
  if (!symbol || volume == null) return
  const now = Date.now()
  const book = books.get(symbol)
  const fresh = book != null && now - book.at < BOOK_FRESH_MS
  const state = samples.state[symbol] ?? { volume: null, price: null, side: 0 }
  let side = state.side
  if (quoteTs && state.volume != null && volume > state.volume && price != null) {
    const delta = volume - state.volume
    const s = tradeSide(price, state.price, fresh ? book.bid : null, fresh ? book.ask : null, state.side)
    const key = taipeiParts(Math.floor(quoteTs / 60) * 60 * 1000).hm
    const minutes = (samples.flow[symbol] ??= {})
    const bucket = (minutes[key] ??= [0, 0])
    if (s > 0) bucket[0] += delta
    else if (s < 0) bucket[1] += delta
    else {
      bucket[0] += delta / 2
      bucket[1] += delta / 2
    }
    side = s || state.side
    dirty = true
  }
  samples.state[symbol] = { volume, price: price ?? state.price, side }
  if (price != null) samples.price[symbol] = price
}

type CnyesQuotes = { statusCode?: number; data?: Record<string, unknown>[] }

async function sampleOnce() {
  const list = watched()
  if (!list.size) return
  const symbols = [...list].map(([symbol, market]) => `${market === 'tpex' ? 'OTC' : 'TWS'}:${symbol}:STOCK`)
  const json = await getJson<CnyesQuotes>(`https://ws.api.cnyes.com/ws/api/v1/quote/quotes/${symbols.join(',')}`)
  if (json.statusCode !== 200) return
  for (const row of json.data ?? []) {
    const symbol = String(row['200010'] ?? '').toUpperCase()
    if (!list.has(symbol)) continue
    let ts = num(row['200007'])
    if (ts != null && ts > 10_000_000_000) ts = ts / 1000
    if (ts != null) rollDate(taipeiParts(ts * 1000).date)
    recordFlow(symbol, num(row['6']), num(row['200013']), ts)
  }
}

type MisPayload = { msgArray?: { c?: string; a?: string; b?: string }[] }

async function refreshBook() {
  const list = watched()
  if (!list.size) return
  const channels = [...list].map(([symbol, market]) => `${market === 'tpex' ? 'otc' : 'tse'}_${symbol}.tw`).join('|')
  const json = await getJson<MisPayload>(
    `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels).replace(/%7C/g, '|')}&json=1&delay=0`,
    { Referer: 'https://mis.twse.com.tw/stock/index.jsp' },
  )
  const now = Date.now()
  for (const row of json.msgArray ?? []) {
    const code = String(row.c ?? '').trim()
    if (!code) continue
    books.set(code, { bid: num(String(row.b ?? '').split('_')[0]), ask: num(String(row.a ?? '').split('_')[0]), at: now })
  }
}

/** 換日就重來（參考程式不重置，昨天的累積量會讓今早一段時間都抽不到樣，這裡不沿用） */
function rollDate(date: string) {
  if (!date || date === samples.date) return
  const markets = samples.markets
  samples = emptyFile(date)
  samples.markets = markets
  dirty = true
}

async function save() {
  if (!dirty || !file) return
  dirty = false
  try {
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    await writeFile(temp, JSON.stringify(samples))
    const { rename } = await import('node:fs/promises')
    await rename(temp, file)
  } catch {
    dirty = true
  }
}

async function loop(step: () => Promise<void>, gap: number) {
  for (;;) {
    if (sampling()) {
      try {
        await step()
      } catch {
        /* 下一輪再試 */
      }
      await sleep(gap)
    } else {
      await sleep(20_000)
    }
  }
}

// ---------- Yahoo 累積外盤／內盤（outMarket／inMarket）----------
// 平日 08:55～13:35 每 3 秒抓一次自選股的 Yahoo 累積外盤、內盤張數，依 Yahoo 報價時間存成每分鐘最後一筆，
// 每天寫進 data/yahoo-flow.json。走勢圖在台新還沒逐筆的分鐘（晚訂閱）先用它，也拿來和台新對照。
type YahooFile = { date: string; flow: Record<string, Record<string, [number, number]>> }
const YAHOO_GAP_MS = 3000
let yahooFile = ''
let yahoo: YahooFile = { date: '', flow: {} }
let yahooDirty = false
let yahooPending: Promise<void> | null = null
let yahooPolledAt = 0
let yahooQueued = false

function yahooWindow(now = Date.now()) {
  const { hm, weekday } = taipeiParts(now)
  return weekday !== 'Sat' && weekday !== 'Sun' && hm >= '08:55' && hm <= '13:35'
}

type YahooRow = { symbol?: string; outMarket?: unknown; inMarket?: unknown; regularMarketTime?: string }

async function yahooOnce() {
  const list = watched()
  if (!list.size) return
  const symbols = [...list]
    .filter(([symbol]) => validFlowSymbol(symbol))
    .map(([symbol, market]) => `${symbol}.${market === 'tpex' ? 'TWO' : 'TW'}`)
  if (!symbols.length) return
  const url =
    'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;fields=avgPrice%2Corderbook;symbols=' +
    encodeURIComponent(symbols.join(','))
  const rows = await getJson<YahooRow[]>(url)
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    const symbol = String(row.symbol ?? '').split('.')[0].toUpperCase()
    const out = num(row.outMarket)
    const inn = num(row.inMarket)
    const at = Date.parse(String(row.regularMarketTime ?? ''))
    if (!symbol || out == null || inn == null || !Number.isFinite(at)) continue
    const { date, hm } = taipeiParts(at)
    // Do not let yesterday's pre-open quote roll storage backwards. Closing auction is excluded.
    if (date !== taipeiParts(Date.now()).date || hm < '09:00' || hm >= '13:25') continue
    if (date !== yahoo.date) {
      await saveYahoo()
      yahoo = { date, flow: {} }
      yahooDirty = true
    }
    const minutes = (yahoo.flow[symbol] ??= {})
    const last = minutes[hm]
    if (!last || last[0] !== out || last[1] !== inn) {
      minutes[hm] = [out, inn]
      yahooDirty = true
    }
  }
}

async function saveYahoo() {
  if (!yahooDirty || !yahooFile) return
  yahooDirty = false
  try {
    const { rename } = await import('node:fs/promises')
    const payload = JSON.stringify(yahoo)
    await mkdir(path.dirname(yahooFile), { recursive: true })
    // Retain every trading day's minute history, not just the most recent day.
    const archive = path.join(path.dirname(yahooFile), 'yahoo-flow-' + yahoo.date + '.json')
    await writeFile(archive + '.tmp', payload)
    await rename(archive + '.tmp', archive)
    await writeFile(`${yahooFile}.tmp`, payload)
    await rename(`${yahooFile}.tmp`, yahooFile)
  } catch {
    yahooDirty = true
  }
}

/** Throttled shared poll; all client-requested symbols are retained in the market registry. */
export function pollYahooNow(immediate = false): Promise<void> {
  if (!started || !yahooFile || !yahooWindow()) return Promise.resolve()
  if (yahooPending) {
    if (immediate) yahooQueued = true
    return yahooPending
  }
  if (!immediate && Date.now() - yahooPolledAt < YAHOO_GAP_MS) return Promise.resolve()
  yahooPolledAt = Date.now()
  yahooPending = yahooOnce().then(() => saveYahoo()).catch(() => { /* next poll retries */ }).finally(() => {
    yahooPending = null
    if (yahooQueued) { yahooQueued = false; void pollYahooNow(true) }
  })
  return yahooPending
}

async function yahooLoop() {
  for (;;) {
    await pollYahooNow()
    await sleep(yahooWindow() ? YAHOO_GAP_MS : 20_000)
  }
}

/** 某檔某天 Yahoo 每分鐘最後看到的累積 [外盤, 內盤] 張數 {"HH:MM": [外, 內]} */
export function yahooFlow(symbol: string, date: string) {
  return yahoo.date === date ? (yahoo.flow[symbol] ?? {}) : {}
}

export async function startFlowSampler(dataDir: string) {
  if (started) return
  started = true
  file = path.join(dataDir, 'flow-samples.json')
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as SampleFile
    if (saved && typeof saved === 'object' && saved.flow) samples = { ...emptyFile(''), ...saved }
  } catch {
    /* 第一次啟動 */
  }
  yahooFile = path.join(dataDir, 'yahoo-flow.json')
  try {
    const saved = JSON.parse(await readFile(yahooFile, 'utf8')) as YahooFile
    if (saved && typeof saved === 'object' && saved.flow) yahoo = saved
  } catch {
    /* 第一次啟動 */
  }
  for (const symbol of Object.keys(samples.markets)) {
    if (!validFlowSymbol(symbol)) {
      delete samples.markets[symbol]
      dirty = true
    }
  }
  void yahooLoop()
  void loop(refreshBook, BOOK_GAP_MS)
  void loop(sampleOnce, QUOTE_GAP_MS)
  const timer = setInterval(() => void save(), 10_000)
  timer.unref?.()
}

/** 某檔某天每分鐘抽樣到的 [外盤, 內盤] 張數 */
export function flowSamples(symbol: string, date: string) {
  return samples.date === date ? (samples.flow[symbol] ?? {}) : {}
}

/** 抽樣用的最新鉅亨成交價（參考程式用它改寫最後一根一分K的收盤） */
export function sampledPrice(symbol: string, date: string) {
  return samples.date === date ? (samples.price[symbol] ?? null) : null
}
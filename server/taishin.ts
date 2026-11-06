import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SparkBook, SparkForce, SparkPoint } from '../src/desk/types.ts'

const dataDir = path.join(process.cwd(), 'data')
const sparkLiveFile = path.join(dataDir, 'spark-live.json')
const sparkWatchFile = path.join(dataDir, 'spark-watch.json')
const WS_URL = 'wss://api.fugle.tw/marketdata/v1.0/stock/streaming'
const REST = 'https://api.fugle.tw/marketdata/v1.0/stock'
/** 發行量加權股價指數（加權指數） */
const INDEX_SYMBOL = 'IX0001'
const INDEX_ALIAS = 't00'

type LiveFile = {
  date: string
  connected: boolean
  updatedAt: string
  symbols: Record<string, SparkBook>
}

type WatchFile = { symbols?: string[] }

type QuoteJson = {
  date?: string
  name?: string
  previousClose?: number
  referencePrice?: number
  openPrice?: number
  highPrice?: number
  lowPrice?: number
  lastPrice?: number
  closePrice?: number
  change?: number
  changePercent?: number
  bids?: { price?: number; size?: number }[]
  asks?: { price?: number; size?: number }[]
  total?: {
    tradeVolume?: number
    tradeVolumeAtBid?: number
    tradeVolumeAtAsk?: number
    time?: number
  }
  lastTrade?: { price?: number; size?: number; time?: number; bid?: number; ask?: number }
  lastUpdated?: number
}

type TickerJson = {
  name?: string
  previousClose?: number
  referencePrice?: number
  limitUpPrice?: number
  limitDownPrice?: number
}

let started = false
let socket: WebSocket | null = null
let apiKey = ''
let reconnectTimer: NodeJS.Timeout | null = null
let watchTimer: NodeJS.Timeout | null = null
let flushTimer: NodeJS.Timeout | null = null
let authenticated = false
let authAt = 0
let lastIndexAt = 0
let dirty = false

const books = new Map<string, SparkBook>()
const subscribed = new Set<string>()

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function taipeiClock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

function fromMicros(raw?: number) {
  if (raw == null || !Number.isFinite(raw)) return Date.now()
  return raw > 1e15 ? Math.floor(raw / 1000) : raw > 1e12 ? raw : raw * 1000
}

async function loadKey() {
  for (const env of ['TAISHIN_API_KEY', 'FUGLE_API_KEY', 'FUGLE_KEY']) {
    const value = process.env[env]?.trim()
    if (value) return value
  }
  for (const name of ['taishin-key.txt', 'fugle-key.txt']) {
    try {
      const text = await readFile(path.join(dataDir, name), 'utf8')
      const line = text
        .split(/\r?\n/)
        .map((row) => row.trim())
        .find((row) => row && !row.startsWith('#'))
      if (line) return line
    } catch {
      /* 下一檔 */
    }
  }
  return ''
}

async function readWatch(): Promise<string[]> {
  try {
    const saved = JSON.parse(await readFile(sparkWatchFile, 'utf8')) as WatchFile
    return [...new Set((saved.symbols ?? []).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  } catch {
    return []
  }
}

function emptyBook(symbol: string, name = ''): SparkBook {
  return {
    symbol,
    name,
    limitUp: null,
    limitDown: null,
    open: null,
    price: null,
    prev: null,
    bid: null,
    ask: null,
    high: null,
    low: null,
    volume: null,
    time: '',
    bias: 0,
    points: [],
    force: [],
  }
}

function pushPoint(book: SparkBook, stamp: string, price: number) {
  const last = book.points.at(-1)
  if (last && last.t === stamp) {
    last.p = price
    return
  }
  if (last && last.p === price && last.t.slice(0, 5) === stamp.slice(0, 5)) {
    last.t = stamp
    return
  }
  book.points.push({ t: stamp, p: price } satisfies SparkPoint)
  if (book.points.length > 2400) book.points.splice(0, book.points.length - 2400)
}

function pushForce(book: SparkBook, stamp: string, bias: number) {
  const last = book.force.at(-1)
  if (last && last.t === stamp) {
    last.d = bias
    return
  }
  book.force.push({ t: stamp, d: bias } satisfies SparkForce)
  if (book.force.length > 2400) book.force.splice(0, book.force.length - 2400)
}

async function rest<T>(pathname: string): Promise<T | null> {
  try {
    const res = await fetch(`${REST}${pathname}`, {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function bootstrap(symbol: string) {
  const key = symbol === INDEX_SYMBOL ? INDEX_ALIAS : symbol
  const book = books.get(key) ?? emptyBook(key)
  const [ticker, quote] = await Promise.all([
    rest<TickerJson>(`/intraday/ticker/${encodeURIComponent(symbol)}`),
    rest<QuoteJson>(`/intraday/quote/${encodeURIComponent(symbol)}`),
  ])
  ensureFeedDate()
  if (ticker?.name) book.name = ticker.name
  if (quote?.name) book.name = quote.name
  const prev = ticker?.referencePrice ?? quote?.referencePrice ?? ticker?.previousClose ?? quote?.previousClose ?? null
  if (prev != null && prev > 0) book.prev = prev
  if (ticker?.limitUpPrice != null) book.limitUp = ticker.limitUpPrice
  if (ticker?.limitDownPrice != null) book.limitDown = ticker.limitDownPrice
  if (quote) {
    if (quote.openPrice != null && quote.openPrice > 0) book.open = quote.openPrice
    book.high = quote.highPrice ?? book.high
    book.low = quote.lowPrice ?? book.low
    book.price = quote.lastPrice ?? quote.closePrice ?? book.price
    book.bid = quote.bids?.[0]?.price ?? book.bid
    book.ask = quote.asks?.[0]?.price ?? book.ask
    book.volume = quote.total?.tradeVolume ?? book.volume
    const at = quote.lastTrade?.time ?? quote.lastUpdated ?? quote.total?.time
    if (at) book.time = taipeiClock(fromMicros(at))
    if (book.price != null && book.time) pushPoint(book, book.time, book.price)
    const bidVol = quote.total?.tradeVolumeAtBid
    const askVol = quote.total?.tradeVolumeAtAsk
    if (bidVol != null && askVol != null) {
      book.bias = askVol - bidVol
      if (book.time) pushForce(book, book.time, book.bias)
    }
  }
  books.set(key, book)
  if (key === INDEX_ALIAS && book.price != null) lastIndexAt = Date.now()
  dirty = true
}

function applyTrade(raw: Record<string, unknown>) {
  const symbol = String(raw.symbol ?? '')
  if (!symbol) return
  const book = books.get(symbol) ?? emptyBook(symbol)
  const price = Number(raw.price)
  const size = Number(raw.size ?? 0)
  const bid = Number(raw.bid ?? book.bid ?? 0)
  const ask = Number(raw.ask ?? book.ask ?? 0)
  const stamp = taipeiClock(fromMicros(Number(raw.time)))
  if (!Number.isFinite(price) || price <= 0) return
  book.price = price
  book.time = stamp
  book.bid = Number.isFinite(bid) && bid > 0 ? bid : book.bid
  book.ask = Number.isFinite(ask) && ask > 0 ? ask : book.ask
  book.open ??= price
  book.high = book.high == null ? price : Math.max(book.high, price)
  book.low = book.low == null ? price : Math.min(book.low, price)
  if (Number.isFinite(size) && size > 0) book.volume = (book.volume ?? 0) + size
  pushPoint(book, stamp, price)
  if (Number.isFinite(size) && size > 0) {
    if (ask > 0 && price >= ask) book.bias += size
    else if (bid > 0 && price <= bid) book.bias -= size
    pushForce(book, stamp, book.bias)
  }
  books.set(symbol, book)
  dirty = true
}

function applyBook(raw: Record<string, unknown>) {
  const symbol = String(raw.symbol ?? '')
  if (!symbol) return
  const book = books.get(symbol) ?? emptyBook(symbol)
  const bids = raw.bids as { price?: number }[] | undefined
  const asks = raw.asks as { price?: number }[] | undefined
  const bid = Number(bids?.[0]?.price)
  const ask = Number(asks?.[0]?.price)
  if (Number.isFinite(bid) && bid > 0) book.bid = bid
  if (Number.isFinite(ask) && ask > 0) book.ask = ask
  books.set(symbol, book)
  dirty = true
}

function applyIndex(raw: Record<string, unknown>) {
  const symbol = String(raw.symbol ?? '')
  if (symbol !== INDEX_SYMBOL && symbol !== 'IR0001') return
  const value = Number(raw.index)
  if (!Number.isFinite(value) || value <= 0) return
  const stamp = taipeiClock(fromMicros(Number(raw.time)))
  const book = books.get(INDEX_ALIAS) ?? emptyBook(INDEX_ALIAS, '加權指數')
  book.name = book.name || '加權指數'
  book.price = value
  book.time = stamp
  book.open ??= value
  book.high = book.high == null ? value : Math.max(book.high, value)
  book.low = book.low == null ? value : Math.min(book.low, value)
  pushPoint(book, stamp, value)
  books.set(INDEX_ALIAS, book)
  lastIndexAt = Date.now()
  dirty = true
}

function send(event: string, data?: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(data ? { event, data } : { event }))
}

function subscribeAll(symbols: string[]) {
  send('subscribe', { channel: 'indices', symbol: INDEX_SYMBOL })
  const stocks = symbols.filter((symbol) => symbol !== INDEX_ALIAS && symbol !== INDEX_SYMBOL)
  for (const symbol of stocks) {
    if (subscribed.has(symbol)) continue
    send('subscribe', { channel: 'trades', symbol })
    send('subscribe', { channel: 'books', symbol })
    subscribed.add(symbol)
    void bootstrap(symbol)
  }
}

let feedDate = ''

function ensureFeedDate() {
  const today = taipeiDate()
  if (feedDate && feedDate !== today) {
    books.clear()
    subscribed.clear()
    dirty = true
  }
  feedDate = today
  return today
}

async function flush(connected: boolean) {
  if (!dirty && connected === (await currentConnected())) {
    /* 仍寫心跳，讓燈號依 updatedAt／檔案時間判斷 */
  }
  const today = ensureFeedDate()
  const payload: LiveFile = {
    date: today,
    connected,
    updatedAt: new Date().toISOString(),
    symbols: Object.fromEntries(books),
  }
  await mkdir(dataDir, { recursive: true })
  await writeFile(sparkLiveFile, JSON.stringify(payload), 'utf8')
  dirty = false
}

async function currentConnected() {
  try {
    const saved = JSON.parse(await readFile(sparkLiveFile, 'utf8')) as LiveFile
    return Boolean(saved.connected)
  } catch {
    return false
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, 5000)
  reconnectTimer.unref?.()
}

async function connect() {
  if (!apiKey) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }
  authenticated = false
  try {
    socket = new WebSocket(WS_URL)
  } catch {
    await flush(false)
    scheduleReconnect()
    return
  }

  socket.addEventListener('open', () => {
    send('auth', { apikey: apiKey })
  })

  socket.addEventListener('message', (event) => {
    let msg: { event?: string; channel?: string; data?: unknown }
    try {
      msg = JSON.parse(String(event.data)) as typeof msg
    } catch {
      return
    }
    if (msg.event === 'authenticated') {
      authenticated = true
      authAt = Date.now()
      dirty = true
      void (async () => {
        await bootstrap(INDEX_SYMBOL)
        subscribeAll(await readWatch())
        await flush(true)
      })()
      return
    }
    if (msg.event === 'error') {
      authenticated = false
      void flush(false)
      return
    }
    if (msg.event === 'heartbeat' || msg.event === 'pong') {
      dirty = true
      return
    }
    if (msg.event !== 'data' && msg.event !== 'snapshot') return
    const raw = msg.data
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const row = raw as Record<string, unknown>
    if (msg.channel === 'indices' || row.type === 'INDEX') applyIndex(row)
    else if (msg.channel === 'books' || Array.isArray(row.bids) || Array.isArray(row.asks)) applyBook(row)
    else applyTrade(row)
  })

  socket.addEventListener('close', () => {
    authenticated = false
    subscribed.clear()
    socket = null
    void flush(false)
    scheduleReconnect()
  })

  socket.addEventListener('error', () => {
    authenticated = false
  })
}

/**
 * 台新／Fugle 即時行情餵價。金鑰放在另一台機器的
 * data/taishin-key.txt、data/fugle-key.txt 或環境變數 TAISHIN_API_KEY／FUGLE_API_KEY。
 */
export async function startTaishinFeed() {
  if (started) return
  started = true
  apiKey = await loadKey()
  if (!apiKey) {
    console.info('[taishin] 未找到 API 金鑰，看盤改走證交所／其他備援')
    return
  }
  console.info('[taishin] 啟動即時行情連線')
  void connect()
  watchTimer = setInterval(() => {
    if (!authenticated) return
    void readWatch().then((symbols) => subscribeAll(symbols))
  }, 5000)
  watchTimer.unref?.()
  flushTimer = setInterval(() => {
    void flush(taishinConnectedNow())
  }, 1000)
  flushTimer.unref?.()
}

function twSession(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]))
  const weekday = parts.weekday ?? ''
  const mins = Number(parts.hour) * 60 + Number(parts.minute)
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) && mins >= 9 * 60 && mins <= 13 * 60 + 30
}

export function taishinConnectedNow() {
  if (!authenticated) return false
  if (!twSession()) return true
  if (lastIndexAt > 0) return Date.now() - lastIndexAt < 90_000
  return Date.now() - authAt < 45_000
}

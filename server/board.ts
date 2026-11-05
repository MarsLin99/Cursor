import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  DeskReport,
  IntradayBar,
  MacroSnapshot,
  QuoteRow,
  SparkBook,
  SparkFlow,
  SparkForce,
  SparkPoint,
  TickerItem,
  WinPick,
} from '../src/desk/types.ts'
import { getInsightBundle, makeInsightReport, readInsightReport } from './insight.ts'
import { startTaishinFeed, taishinConnectedNow } from './taishin.ts'

const dataDir = path.join(process.cwd(), 'data')
const macroFile = path.join(dataDir, 'macro-cache.json')
const reportFile = path.join(dataDir, 'report-cache.json')
const winFile = path.join(dataDir, 'winrate-cache.json')
const keyFile = path.join(dataDir, 'xai-key.txt')
const trumpZhFile = path.join(dataDir, 'trump-zh.json')
const tickerFile = path.join(dataDir, 'ticker-cache.json')
const sparkLiveFile = path.join(dataDir, 'spark-live.json')
const sparkWatchFile = path.join(dataDir, 'spark-watch.json')

const SLOTS = ['08:40', '14:00', '15:10', '21:00']
const UA = 'Mozilla/5.0 (compatible; TaHedgeLab/1.0)'

const LIQUID: { symbol: string; name: string }[] = [
  { symbol: '2330', name: '台積電' },
  { symbol: '2317', name: '鴻海' },
  { symbol: '2454', name: '聯發科' },
  { symbol: '2308', name: '台達電' },
  { symbol: '2382', name: '廣達' },
  { symbol: '2412', name: '中華電' },
  { symbol: '2881', name: '富邦金' },
  { symbol: '2882', name: '國泰金' },
  { symbol: '2891', name: '中信金' },
  { symbol: '2603', name: '長榮' },
  { symbol: '2609', name: '陽明' },
  { symbol: '1301', name: '台塑' },
  { symbol: '1303', name: '南亞' },
  { symbol: '2002', name: '中鋼' },
  { symbol: '3711', name: '日月光投控' },
  { symbol: '6669', name: '緯穎' },
  { symbol: '3034', name: '聯詠' },
  { symbol: '2379', name: '瑞昱' },
  { symbol: '3231', name: '緯創' },
  { symbol: '2357', name: '華碩' },
  { symbol: '0050', name: '元大台灣50' },
]

type CacheShape = MacroSnapshot

type TickerStock = { symbol: string; name: string; market: 'twse' | 'tpex' }
type TickerCache = { updatedAt: string | null; items: TickerItem[]; stocks: TickerStock[] }

let memory: CacheShape | null = null
let reportMemory: DeskReport | null = null
let tickerMemory: TickerCache | null = null
let scanning = false
let tickerRefreshing = false
let tickerAgain = false
let timer: NodeJS.Timeout | null = null

function emptySnapshot(): CacheShape {
  return {
    scannedAt: null,
    scanning: false,
    index: { price: null, change: null, pct: null, date: '', time: '' },
    institutions: { foreign: null, trust: null, dealer: null },
    sectors: [],
    gold: null,
    brent: null,
    indexHistory: [],
    news: [],
    blanks: ['景氣燈號', '出口年增率', 'BDI', 'BAI', 'ISM 製造業', '薩姆規則', '全市場擔保維持率'],
  }
}

function taipeiNow(date = new Date()) {
  const text = date.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' })
  const [day, time] = text.split(' ')
  const [year, month, d] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return { year, month, day: d, hour, minute, stamp: `${day} ${time.slice(0, 5)}` }
}

function slotTime(year: number, month: number, day: number, hhmm: string) {
  const [hour, minute] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0))
  return guess
}

function latestDueSlot(now = new Date()) {
  const t = taipeiNow(now)
  const today = SLOTS.map((slot) => slotTime(t.year, t.month, t.day, slot))
  const passed = today.filter((slot) => slot.getTime() <= now.getTime())
  if (passed.length) return passed[passed.length - 1]
  const y = new Date(now.getTime() - 24 * 3600 * 1000)
  const p = taipeiNow(y)
  return slotTime(p.year, p.month, p.day, SLOTS[SLOTS.length - 1])
}

function stale(snapshot: CacheShape | null) {
  if (!snapshot?.scannedAt) return true
  return new Date(snapshot.scannedAt).getTime() < latestDueSlot().getTime()
}

function taipeiClock(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]))
  return {
    weekday: parts.weekday ?? '',
    mins: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/** 台股 09:00–13:30、美股 21:30–05:00（台北時間，週一至週五的交易時段） */
function inSession(now = new Date()) {
  const { weekday, mins } = taipeiClock(now)
  const twDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  if (twDays.includes(weekday) && mins >= 9 * 60 && mins <= 13 * 60 + 30) return true
  if (mins >= 21 * 60 + 30 && twDays.includes(weekday)) return true
  return mins < 5 * 60 && ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(weekday)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf8')
}

async function getText(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

function num(raw: string | number | null | undefined) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function stripTag(raw: string) {
  return raw.replace(/<[^>]+>/g, '')
}

async function fetchIndexAndSectors() {
  const json = JSON.parse(
    await getText('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&type=IND'),
  ) as {
    date?: string
    tables?: { data?: string[][] }[]
  }
  const rows = json.tables?.[0]?.data ?? []
  const indexRow = rows.find((row) => row[0] === '發行量加權股價指數')
  const sectors = rows
    .filter((row) => row[0]?.endsWith('類指數'))
    .map((row) => {
      const pctRaw = num(row[4]) ?? 0
      const pointsRaw = num(row[3]) ?? 0
      const sign = stripTag(row[2] ?? '')
      const negative = sign.includes('-') || pctRaw < 0
      const pct = negative ? -Math.abs(pctRaw) : pctRaw
      return {
        name: row[0].replace(/類指數$/, ''),
        pct,
        points: negative ? -Math.abs(pointsRaw) : Math.abs(pointsRaw),
        flow: null as number | null,
      }
    })
  const rates = await fetchFlowRates().catch(() => new Map<string, number>())
  for (const sector of sectors) {
    sector.flow = flowRate(sector.name, rates)
  }
  const price = num(indexRow?.[1] ?? null)
  const change = num(indexRow?.[3] ?? null)
  const sign = stripTag(indexRow?.[2] ?? '')
  const signed = change == null ? null : sign.includes('-') ? -Math.abs(change) : Math.abs(change)
  return {
    date: json.date ?? '',
    index: {
      price,
      change: signed,
      pct: num(indexRow?.[4] ?? null),
      date: json.date ?? '',
      time: '',
    },
    sectors,
  }
}

const FLOW_ALIAS: Record<string, string> = { 化學: '化工', 航運: '航運業' }

function flowRate(name: string, rates: Map<string, number>) {
  if (rates.has(name)) return rates.get(name) ?? null
  const alias = FLOW_ALIAS[name]
  if (alias && rates.has(alias)) return rates.get(alias) ?? null
  return null
}

let flowUpdated = ''

async function fetchFlowRates() {
  const res = await fetch('https://www.moneydj.com/Z/ZB/ZBA/ZBA.djhtm', {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`${res.status} moneydj flow`)
  const html = new TextDecoder('big5').decode(await res.arrayBuffer())
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, '').trim())
    .filter(Boolean)
  const start = lines.findIndex((line) => line.startsWith('上市資金流向表'))
  const stamp = lines.slice(Math.max(0, start), start + 4).join('').match(/最後更新時間[:：]?(\d{1,2})\/(\d{1,2})(?:(\d{1,2}:\d{2}))?/)
  if (stamp) flowUpdated = `${Number(stamp[1])}/${Number(stamp[2])}${stamp[3] ? ` ${stamp[3]}` : ''}`
  const end = lines.findIndex((line, index) => index > start && line.startsWith('上櫃'))
  const body = start >= 0 ? lines.slice(start + 1, end > start ? end : start + 80) : []
  const rates = new Map<string, number>()
  for (let i = 1; i < body.length; i++) {
    if (!/^\d+(?:\.\d+)?%$/.test(body[i])) continue
    const name = body[i - 1]
    if (!name || name.includes('%') || name === '類股名稱' || name === '流向率') continue
    rates.set(name, Number(body[i].replace('%', '')))
  }
  return rates
}

let sectorRefreshing = false
let flowAt = 0

/** 證交所上市類股指數代碼（MIS 盤中每 5 秒更新；台新報價沒有類股指數） */
const SECTOR_CODES = [
  't01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10',
  't11', 't12', 't13', 't14', 't15', 't16', 't17', 't18', 't20', 't21',
  't22', 't23', 't24', 't25', 't26', 't27', 't28', 't29', 't30', 't31',
]

async function fetchMisSectors() {
  const url =
    'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
    SECTOR_CODES.map((code) => `tse_${code}.tw`).join('|') +
    `&json=1&delay=0&_=${Date.now()}`
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/index.jsp' },
  })
  if (!res.ok) throw new Error(`${res.status} mis sectors`)
  const json = (await res.json()) as { msgArray?: Record<string, string>[] }
  let date = ''
  let time = ''
  const sectors = (json.msgArray ?? []).flatMap((row) => {
    const name = String(row.n ?? '').replace(/類指數$/, '').trim()
    const price = row.z && row.z !== '-' ? num(row.z) : null
    const prev = row.y ? num(row.y) : null
    if (!name || price == null || !prev) return []
    if ((row.d ?? '') > date) date = row.d ?? ''
    if ((row.t ?? '') > time) time = row.t ?? ''
    return [
      {
        name,
        pct: Math.round(((price - prev) / prev) * 10000) / 100,
        points: Math.round((price - prev) * 100) / 100,
        flow: null as number | null,
      },
    ]
  })
  return { date, time, sectors }
}

function twSession(now = new Date()) {
  const { weekday, mins } = taipeiClock(now)
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) && mins >= 9 * 60 && mins <= 13 * 60 + 30
}

async function refreshSectors() {
  if (sectorRefreshing) return
  sectorRefreshing = true
  try {
    // 盤中用 MIS 即時類股指數；MIS 失敗才退回盤後 MI_INDEX（前一交易日）
    const live = await fetchMisSectors().catch(() => null)
    let pack: { date: string; time: string; sectors: CacheShape['sectors'] }
    if (live?.sectors.length) {
      const rates = await fetchFlowRates().catch(() => new Map<string, number>())
      for (const sector of live.sectors) sector.flow = flowRate(sector.name, rates)
      pack = live
    } else {
      const after = await fetchIndexAndSectors()
      pack = { date: after.date, time: '', sectors: after.sectors }
    }
    if (!pack.sectors.length) return
    const base = memory ?? (await readJson<CacheShape>(macroFile)) ?? emptySnapshot()
    memory = {
      ...base,
      sectors: pack.sectors,
      sectorsAt: new Date().toISOString(),
      sectorsTime: pack.time,
      flowUpdated,
      index: { ...base.index, date: pack.date || base.index.date },
    }
    await writeJson(macroFile, memory)
    flowAt = Date.now()
  } catch {
    /* 下一輪再試 */
  } finally {
    sectorRefreshing = false
  }
}

function maybeRefreshSectors() {
  const missing = !memory?.sectors.some((row) => row.flow != null)
  if (!missing && !twSession()) return
  // 盤中 30 秒一輪（OneWebStock 快取 45 秒；MIS 類股指數本身約每 1 分多鐘才換一次）
  if (!missing && Date.now() - flowAt < 30_000) return
  void refreshSectors()
}

async function fetchInstitutions() {
  const json = JSON.parse(
    await getText('https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json'),
  ) as { data?: string[][] }
  const find = (label: string) =>
    num(json.data?.find((row) => row[0] === label)?.[3] ?? null)
  const dealerSelf = find('自營商(自行買賣)') ?? 0
  const dealerHedge = find('自營商(避險)') ?? 0
  return {
    foreign: find('外資及陸資(不含外資自營商)'),
    trust: find('投信'),
    dealer: dealerSelf + dealerHedge,
  }
}

async function fetchYahooQuote(symbol: string) {
  const json = JSON.parse(
    await getText(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    ),
  ) as {
    chart?: { result?: { meta?: Record<string, number> }[] }
  }
  const meta = json.chart?.result?.[0]?.meta
  if (!meta) return null
  const price = meta.regularMarketPrice ?? null
  const prev = meta.previousClose ?? meta.chartPreviousClose ?? null
  const change =
    meta.regularMarketChange ??
    (price != null && prev != null ? price - prev : null)
  const pct =
    meta.regularMarketChangePercent ??
    (change != null && prev ? (change / prev) * 100 : null)
  return { price, change, pct }
}

async function fetchIndexHistory() {
  const json = JSON.parse(
    await getText(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=6mo',
    ),
  ) as {
    chart?: {
      result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[]
    }
  }
  const result = json.chart?.result?.[0]
  const ts = result?.timestamp ?? []
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  return ts.flatMap((stamp, i) => {
    const value = closes[i]
    if (value == null) return []
    const date = new Date(stamp * 1000)
    const time = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
    return [{ time, value }]
  })
}

type CnyesRow = { title?: string; publishAt?: number; newsId?: number }

const MARKET_RE =
  /台股|美股|台指|加權|那斯達克|道瓊|標普|費半|聯準會|升息|降息|通膨|關稅|戰爭|開戰|海峽|封鎖|以色列|烏克蘭|俄羅斯|伊朗|原油|石油|黃金|美債|殖利率|衰退|非農|就業|(?<![\d兆])美元|停火|空襲|紅海|荷姆茲|霍爾木茲|供應鏈|出口管制|台海|晶片禁令|新台幣|央行|Fed/
const MAJOR_RE = /戰爭|開戰|海峽|封鎖|空襲|停火|關稅|崩盤|重挫|熔斷|飛彈|荷姆茲|霍爾木茲|台海/
const TIP_RE = /這檔|點名|抱緊|存股|教學|飆股|秘密|主力悄悄/
const GEO_RE = /戰爭|開戰|海峽|封鎖|空襲|停火|以色列|烏克蘭|俄羅斯|伊朗|紅海|荷姆茲|霍爾木茲|飛彈|制裁|台海|解放軍/
const US_RE =
  /美國|美股|聯準會|Fed|道瓊|那斯達克|標普|費半|非農|就業|通膨|(?<![\d兆])美元|白宮|美債|殖利率|降息|升息|川普/
const INDEX_RE =
  /台股|美股|台指|加權|道瓊|那斯達克|標普|費半|聯準會|Fed|非農|就業|通膨|降息|升息|戰爭|伊朗|關稅|原油|黃金|殖利率|行情|央行/
const SINGLE_NAME = /特斯拉|輝達|英偉達|蘋果|微軟|亞馬遜|谷歌|Google|Meta|台積電|鴻海|聯發科|大立光|SpaceX/
const TW_RE = /台股|台指|加權|央行|新台幣|出口|國發會|證交所|櫃買/

function hhmm(ms: number) {
  const text = new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' })
  const [day, time] = text.split(' ')
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
  const clock = time.slice(0, 5)
  if (day === today) return clock
  const [, month, date] = day.split('-')
  return `${Number(month)}/${Number(date)} ${clock}`
}

function plainTitle(raw: string) {
  return stripTag(raw)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function articleUrl(id: number) {
  return `https://news.cnyes.com/news/id/${id}`
}

function leaksUnchecked(title: string, names: string[]) {
  return LIQUID.some(
    (stock) =>
      title.includes(stock.name) && !names.some((name) => name.includes(stock.name)),
  )
}

function fromCnyes(row: CnyesRow, kind: TickerItem['kind'], tag: string): TickerItem | null {
  if (!row.newsId || !row.title || !row.publishAt) return null
  const title = plainTitle(row.title)
  if (!title || TIP_RE.test(title)) return null
  return {
    tag,
    kind,
    time: hhmm(row.publishAt * 1000),
    title,
    url: articleUrl(row.newsId),
    at: row.publishAt * 1000,
  }
}

async function cnyesCategory(category: string, limit: number) {
  const json = JSON.parse(
    await getText(`https://news.cnyes.com/api/v3/news/category/${category}?limit=${limit}`),
  ) as { items?: { data?: CnyesRow[] } }
  return json.items?.data ?? []
}

let marketCache: { at: number; items: TickerItem[] } | null = null

async function marketTicker() {
  if (marketCache && Date.now() - marketCache.at < 3 * 60_000) return marketCache.items
  const [tw, world, us] = await Promise.all([
    cnyesCategory('tw_macro', 8).catch(() => [] as CnyesRow[]),
    cnyesCategory('wd_macro', 8).catch(() => [] as CnyesRow[]),
    cnyesCategory('us_stock', 8).catch(() => [] as CnyesRow[]),
  ])
  const picked: TickerItem[] = []
  const seen = new Set<string>()
  const take = (rows: CnyesRow[], ok: (title: string) => boolean) => {
    for (const row of rows) {
      const item = fromCnyes(row, 'flash', '快訊')
      if (!item || seen.has(item.url) || !ok(item.title)) continue
      if (SINGLE_NAME.test(item.title) && !INDEX_RE.test(item.title)) continue
      if (MAJOR_RE.test(item.title)) {
        item.kind = 'major'
        item.tag = '重大'
      }
      seen.add(item.url)
      picked.push(item)
    }
  }
  take(tw, (title) => TW_RE.test(title) || MARKET_RE.test(title))
  take(us, (title) => US_RE.test(title) || MARKET_RE.test(title))
  take(world, (title) => GEO_RE.test(title) || US_RE.test(title) || TW_RE.test(title))
  const items = picked.sort((a, b) => b.at - a.at).slice(0, 6)
  marketCache = { at: Date.now(), items }
  return items
}

let zhMemory: Record<string, string> | null = null

async function translateZhTw(text: string) {
  const q = encodeURIComponent(text.slice(0, 900))
  const raw = await getText(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${q}`,
  )
  const json = JSON.parse(raw) as [Array<[string]>]
  return json[0].map((part) => part[0]).join('').trim()
}

let trumpCache: { at: number; items: TickerItem[] } | null = null

async function trumpTicker() {
  if (trumpCache && Date.now() - trumpCache.at < 3 * 60_000) return trumpCache.items
  const xml = await getText('https://trumpstruth.org/feed')
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12)
  if (!zhMemory) zhMemory = (await readJson<Record<string, string>>(trumpZhFile)) ?? {}
  const items: TickerItem[] = []
  let dirty = false
  for (const block of blocks) {
    if (items.length >= 4) break
    const body = block[1]
    const pick = (tag: string) =>
      (body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .trim()
    const link = plainTitle(pick('link'))
    const title = plainTitle(pick('title'))
    const pub = pick('pubDate')
    if (!link || !title || /^image post/i.test(title) || title.length < 16) continue
    let zh = zhMemory[link]
    if (zh?.includes('特朗普')) {
      zh = zh.replaceAll('特朗普', '川普')
      zhMemory[link] = zh
      dirty = true
    }
    if (!zh) {
      try {
        zh = await translateZhTw(title)
      } catch {
        zh = ''
      }
      if (zh) {
        zh = zh.replaceAll('特朗普', '川普')
        zhMemory[link] = zh
        dirty = true
      }
    }
    if (!zh) continue
    const at = Date.parse(pub)
    items.push({
      tag: '川普',
      kind: 'trump',
      time: Number.isFinite(at) ? hhmm(at) : '',
      title: zh,
      url: link,
      at: Number.isFinite(at) ? at : 0,
    })
  }
  if (dirty) await writeJson(trumpZhFile, zhMemory)
  trumpCache = { at: Date.now(), items }
  return items
}

const stockNewsCache = new Map<string, { at: number; items: TickerItem[] }>()

async function yahooStockPage(symbol: string, suffix: 'TW' | 'TWO') {
  const res = await fetch(`https://tw.stock.yahoo.com/quote/${symbol}.${suffix}/news`, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  })
  if (!res.ok) return [] as TickerItem[]
  const html = await res.text()
  const re =
    /<a href="(https:\/\/tw\.stock\.yahoo\.com\/news\/[^"]+)"[^>]*>\s*(?:<u[^>]*><\/u>)?([^<]{6,180})<\/a><\/h3><p[^>]*>([^<]{0,500})/g
  const items: TickerItem[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(re)) {
    const url = match[1].split('?')[0]
    const title = plainTitle(match[2])
    if (!title || seen.has(url)) continue
    seen.add(url)
    const dated = plainTitle(match[3] ?? '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
    const at = dated
      ? Date.parse(
          `${dated[1]}-${dated[2].padStart(2, '0')}-${dated[3].padStart(2, '0')}T01:00:00+08:00`,
        )
      : 0
    items.push({
      tag: '',
      kind: 'stock',
      time: dated ? `${Number(dated[2])}/${Number(dated[3])}` : '',
      title,
      url,
      at: Number.isFinite(at) ? at : 0,
    })
  }
  return items
}

async function stockTicker(symbol: string, name: string, market: 'twse' | 'tpex') {
  const key = `${market}:${symbol}:${name}`
  const hit = stockNewsCache.get(key)
  if (hit && Date.now() - hit.at < 3 * 60_000) return hit.items
  const suffix = market === 'tpex' ? 'TWO' : 'TW'
  const other = suffix === 'TW' ? 'TWO' : 'TW'
  const needle = name.replace(/\s/g, '')
  const tag = name.length > 8 ? symbol : name || symbol
  const matches = (title: string) => {
    const text = title.replace(/\s/g, '')
    return (needle.length >= 2 && text.includes(needle)) || text.includes(symbol)
  }
  let rows = (await yahooStockPage(symbol, suffix)).filter((item) => matches(item.title))
  if (!rows.length) rows = (await yahooStockPage(symbol, other)).filter((item) => matches(item.title))
  const items = rows
    .sort((a, b) => b.at - a.at)
    .slice(0, 2)
    .map((item) => ({ ...item, tag, symbol }))
  stockNewsCache.set(key, { at: Date.now(), items })
  return items
}

export async function buildTicker(
  stocks: { symbol: string; name: string; market: 'twse' | 'tpex' }[],
) {
  const [market, trump, groups] = await Promise.all([
    marketTicker().catch(() => [] as TickerItem[]),
    trumpTicker().catch(() => [] as TickerItem[]),
    Promise.all(
      stocks
        .slice(0, 12)
        .map((stock) =>
          stockTicker(stock.symbol, stock.name, stock.market).catch(() => [] as TickerItem[]),
        ),
    ),
  ])
  const names = stocks.map((stock) => stock.name)
  const seen = new Set<string>()
  return [...market.filter((item) => !leaksUnchecked(item.title, names)), ...trump, ...groups.flat()]
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .sort((a, b) => b.at - a.at)
}

function parseTickerStocks(raw: string) {
  const stocks: TickerStock[] = []
  for (const part of raw.split(',')) {
    if (!part) continue
    const [symbol, marketRaw, ...rest] = part.split(':')
    if (!symbol || !/^[0-9A-Z]{4,8}$/.test(symbol)) continue
    stocks.push({
      symbol,
      market: marketRaw === 'tpex' ? 'tpex' : 'twse',
      name: rest.join(':').slice(0, 20),
    })
    if (stocks.length >= 12) break
  }
  return stocks
}

function sameStocks(a: TickerStock[], b: TickerStock[]) {
  const key = (rows: TickerStock[]) => rows.map((row) => `${row.market}:${row.symbol}:${row.name}`).join('|')
  return key(a) === key(b)
}

async function refreshTicker() {
  if (tickerRefreshing) {
    tickerAgain = true
    return
  }
  tickerRefreshing = true
  try {
    do {
      tickerAgain = false
      const stocks = tickerMemory?.stocks ?? []
      const items = await buildTicker(stocks)
      tickerMemory = {
        updatedAt: new Date().toISOString(),
        items,
        stocks: tickerMemory?.stocks ?? stocks,
      }
      await writeJson(tickerFile, tickerMemory)
    } while (tickerAgain)
  } catch {
    /* 下一輪盤中再試 */
  } finally {
    tickerRefreshing = false
  }
}

function maybeRefreshTicker() {
  if (!inSession()) return
  const at = tickerMemory?.updatedAt ? new Date(tickerMemory.updatedAt).getTime() : 0
  if (Date.now() - at >= 3 * 60_000) void refreshTicker()
}

export async function scanMacro() {
  if (scanning) return memory
  scanning = true
  const base = memory ?? (await readJson<CacheShape>(macroFile)) ?? emptySnapshot()
  try {
    const [indexPack, institutions, gold, brent, indexHistory] = await Promise.all([
      fetchIndexAndSectors().catch(() => null),
      fetchInstitutions().catch(() => null),
      fetchYahooQuote('GC=F').catch(() => null),
      fetchYahooQuote('BZ=F').catch(() => null),
      fetchIndexHistory().catch(() => []),
    ])
    const next: CacheShape = {
      ...base,
      scannedAt: new Date().toISOString(),
      scanning: false,
      index: indexPack?.index ?? base.index,
      sectors: indexPack?.sectors ?? base.sectors,
      institutions: institutions ?? base.institutions,
      gold,
      brent,
      indexHistory: indexHistory.length ? indexHistory : base.indexHistory,
      news: base.news,
    }
    memory = next
    await writeJson(macroFile, next)
    return next
  } finally {
    scanning = false
    if (memory) memory = { ...memory, scanning: false }
  }
}

function quoteChannel(symbol: string, market: 'twse' | 'tpex') {
  const head = market === 'tpex' ? 'otc' : 'tse'
  return `${head}_${symbol}.tw`
}

function parseMis(row: Record<string, string>, market: 'twse' | 'tpex'): QuoteRow {
  const price = num(row.z)
  const prev = num(row.y)
  const usable = price != null && price > 0 ? price : null
  const change = usable != null && prev != null ? usable - prev : null
  const bid = num(String(row.b ?? '').split('_')[0])
  const ask = num(String(row.a ?? '').split('_')[0])
  return {
    symbol: row.c,
    name: row.n,
    market,
    price: usable,
    change,
    pct: change != null && prev ? (change / prev) * 100 : null,
    bid,
    ask,
    volume: num(row.v),
    open: num(row.o),
    high: num(row.h),
    low: num(row.l),
    prev,
    time: row.t || row['%'] || '',
  }
}

export async function fetchQuotes(
  items: { symbol: string; market: 'twse' | 'tpex' }[],
) {
  if (!items.length) return [] as QuoteRow[]
  const joined = items.map((item) => quoteChannel(item.symbol, item.market)).join('|')
  const json = JSON.parse(
    await getText(
      `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(joined)}&json=1&delay=0`,
    ),
  ) as { msgArray?: Record<string, string>[] }
  const byCode = new Map((json.msgArray ?? []).map((row) => [row.c, row]))
  return items.map((item) => {
    const row = byCode.get(item.symbol)
    if (!row) {
      return {
        symbol: item.symbol,
        name: item.symbol,
        market: item.market,
        price: null,
        change: null,
        pct: null,
        bid: null,
        ask: null,
        volume: null,
        open: null,
        high: null,
        low: null,
        prev: null,
        time: '',
      } satisfies QuoteRow
    }
    return parseMis(row, item.market)
  })
}

type SparkLiveFile = {
  date?: string
  connected?: boolean
  updatedAt?: string
  symbols?: Record<string, SparkBook>
}

/** 台新／Fugle 加權指數可能寫成 t00 或 IX0001 */
const INDEX_KEYS = ['t00', 'IX0001', 'IR0001'] as const

async function readSparkLiveFile() {
  return readJson<SparkLiveFile>(sparkLiveFile)
}

async function readSparkLive() {
  const saved = await readSparkLiveFile()
  return saved?.symbols ?? {}
}

function liveBook(live: Record<string, SparkBook>, symbol: string) {
  if (live[symbol]) return live[symbol]
  if (symbol === 't00') {
    for (const key of INDEX_KEYS) {
      if (live[key]) return live[key]
    }
  }
  return undefined
}

async function taishinLiveStatus() {
  const memoryLive = taishinConnectedNow()
  if (memoryLive) {
    return { connected: true, source: 'taishin' as const, updatedAt: new Date().toISOString() }
  }
  try {
    const [saved, info] = await Promise.all([readSparkLiveFile(), stat(sparkLiveFile)])
    const age = Date.now() - info.mtimeMs
    const today = taipeiDate()
    const dateOk =
      !saved?.date ||
      saved.date === today ||
      saved.date === today.replace(/-/g, '')
    // 台新 quote_bridge 只訂閱個股，不一定有指數；有任一檔報價就算有資料
    const hasIndex = Object.values(saved?.symbols ?? {}).some((book) => book != null && book.price != null) || INDEX_KEYS.some((key) => {
      const book = saved?.symbols?.[key]
      return book != null && book.price != null
    })
    const fresh = age < 90_000
    const flagged = saved?.connected === true
    // 開盤前／收盤後，橋接程式仍標示連線中，就算昨天的資料也亮燈
    const connected = Boolean((dateOk || !twSession()) && hasIndex && (flagged || fresh) && (fresh || !twSession()))
    return {
      connected,
      source: connected ? ('taishin' as const) : ('none' as const),
      updatedAt: saved?.updatedAt ?? info.mtime.toISOString(),
    }
  } catch {
    return { connected: false, source: 'none' as const, updatedAt: null }
  }
}

function sparkItems(raw: string) {
  const seen = new Map<string, 'twse' | 'tpex'>()
  for (const part of raw.split(',')) {
    const [code, market] = part.split(':')
    const symbol = (code ?? '').trim().toUpperCase()
    if (!/^[0-9A-Z]{4,6}$/.test(symbol) || seen.has(symbol)) continue
    seen.set(symbol, (market ?? '').trim().toLowerCase() === 'tpex' ? 'tpex' : 'twse')
  }
  return [...seen].map(([symbol, market]) => ({ symbol, market }))
}

// 台新訂閱名單：任何畫面（走勢圖勾選或報價列表）10 分鐘內要過的代號都保留，
// 避免多個分頁/裝置互相覆蓋造成反覆退訂、漏收逐筆。
const sparkSeen = new Map<string, number>()
let sparkWatchSaved = ''
const SPARK_KEEP_MS = 10 * 60 * 1000

async function rememberSparkWatch(symbols: string[]) {
  const now = Date.now()
  for (const symbol of symbols) sparkSeen.set(symbol, now)
  for (const [symbol, at] of sparkSeen) if (now - at > SPARK_KEEP_MS) sparkSeen.delete(symbol)
  const list = [...sparkSeen.entries()].sort((x, y) => y[1] - x[1]).slice(0, 50).map(([symbol]) => symbol).sort()
  const key = list.join(',')
  if (!list.length || key === sparkWatchSaved) return
  sparkWatchSaved = key
  await writeJson(sparkWatchFile, { symbols: list })
}

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function overlaySpark(rows: QuoteRow[], live: Record<string, SparkBook>) {
  return rows.map((row) => {
    const book = liveBook(live, row.symbol)
    if (!book || book.price == null) return row
    const prev = book.prev ?? row.prev
    const change = prev != null ? book.price - prev : row.change
    return {
      ...row,
      name: book.name || row.name,
      price: book.price,
      open: book.open ?? row.open,
      high: book.high ?? row.high,
      low: book.low ?? row.low,
      prev,
      change,
      pct: change != null && prev ? (change / prev) * 100 : row.pct,
      bid: book.bid ?? row.bid,
      ask: book.ask ?? row.ask,
      volume: book.volume ?? row.volume,
      time: book.time || row.time,
    }
  })
}

/** 台新有資料就用台新；缺的代號才打證交所 MIS。 */
async function fetchQuotesPreferTaishin(
  items: { symbol: string; market: 'twse' | 'tpex' }[],
) {
  const live = await readSparkLive()
  const missing = items.filter((item) => liveBook(live, item.symbol)?.price == null)
  const mis = missing.length ? await fetchQuotes(missing).catch(() => [] as QuoteRow[]) : []
  const bySymbol = new Map(mis.map((row) => [row.symbol, row]))
  const blank = (item: { symbol: string; market: 'twse' | 'tpex' }): QuoteRow => ({
    symbol: item.symbol,
    name: item.symbol,
    market: item.market,
    price: null,
    change: null,
    pct: null,
    bid: null,
    ask: null,
    volume: null,
    open: null,
    high: null,
    low: null,
    prev: null,
    time: '',
  })
  const base = items.map((item) => bySymbol.get(item.symbol) ?? blank(item))
  return overlaySpark(base, live)
}

async function fetchIntradaySuffix(symbol: string, suffix: 'TW' | 'TWO') {
  const json = JSON.parse(
    await getText(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.${suffix}?interval=1m&range=1d`,
    ),
  ) as {
    chart?: {
      result?: {
        timestamp?: number[]
        indicators?: { quote?: { close?: (number | null)[]; volume?: (number | null)[] }[] }
      }[]
    }
  }
  const result = json.chart?.result?.[0]
  const ts = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]
  const bars: IntradayBar[] = []
  let prev = quote?.close?.find((value) => value != null) ?? 0
  for (let i = 0; i < ts.length; i++) {
    const close = quote?.close?.[i]
    if (close == null) continue
    const date = new Date(ts[i] * 1000)
    const time = date.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
    })
    if (time < '09:00' || time > '13:30') continue
    bars.push({
      time,
      close,
      volume: quote?.volume?.[i] ?? 0,
      up: close >= prev,
    })
    prev = close
  }
  return bars
}

export async function fetchIntraday(symbol: string, market: 'twse' | 'tpex') {
  const order: Array<'TW' | 'TWO'> = market === 'tpex' ? ['TWO', 'TW'] : ['TW', 'TWO']
  for (const suffix of order) {
    try {
      const bars = await fetchIntradaySuffix(symbol, suffix)
      if (bars.length) return bars
    } catch {
      /* 上市櫃代號對不到時換另一個市場 */
    }
  }
  return []
}

// ── 走勢圖資料：台新逐筆優先，缺的分鐘用鉅亨一分K、再用 Yahoo 一分K 補 ──

/** quote_bridge 另外記錄每分鐘外盤／內盤張數 {"HH:MM": [外盤, 內盤]} */
type LiveSparkBook = SparkBook & { minutes?: Record<string, [number, number]> }

type MinuteBar = { m: number; o: number; h: number; l: number; c: number; v: number }
type DatedBar = MinuteBar & { date: string }

type ExternalQuote = {
  name: string | null
  price: number | null
  high: number | null
  low: number | null
  prev: number | null
  limitUp: number | null
  limitDown: number | null
  volume: number | null
}

type ExternalDay = {
  date: string
  bars: MinuteBar[]
  cnyes: number
  yahoo: number
  quote: ExternalQuote | null
}

const SPARK_OPEN = 9 * 60
const SPARK_CLOSE = 13 * 60 + 30
const EXTERNAL_TTL_MS = 30_000
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

function finiteOf(value: unknown) {
  if (value == null || value === '') return null
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value)
  return Number.isFinite(n) ? n : null
}

function taipeiMinute(sec: number) {
  const d = new Date((sec + 8 * 3600) * 1000)
  return { date: d.toISOString().slice(0, 10), m: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

function hms(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`
}

function stampMinute(stamp: string) {
  const [h, m] = stamp.split(':').map(Number)
  return h * 60 + m
}

function inSparkSession(m: number) {
  return m >= SPARK_OPEN && m <= SPARK_CLOSE
}

async function getJsonFrom<T>(url: string, referer: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Referer: referer },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}

type CnyesChart = {
  data?: {
    t?: number[]
    o?: (number | null)[]
    h?: (number | null)[]
    l?: (number | null)[]
    c?: (number | null)[]
    v?: (number | null)[]
    quote?: Record<string, unknown>
  }
}

/** 鉅亨一分K（成交量單位：張），附帶即時報價欄位 6 成交、12 高、13 低、21 昨收、75/76 漲跌停 */
async function fetchCnyesMinutes(symbol: string, market: 'twse' | 'tpex') {
  const code = `${market === 'tpex' ? 'OTC' : 'TWS'}:${symbol}:STOCK`
  const json = await getJsonFrom<CnyesChart>(
    `https://ws.api.cnyes.com/ws/api/v1/charting/history?resolution=1&symbol=${encodeURIComponent(code)}&quote=1`,
    'https://invest.cnyes.com/',
  )
  const data = json.data ?? {}
  const bars: DatedBar[] = []
  const times = data.t ?? []
  for (let i = 0; i < times.length; i++) {
    const c = finiteOf(data.c?.[i])
    if (c == null) continue
    let sec = Number(times[i])
    if (sec > 1e10) sec = Math.floor(sec / 1000)
    const { date, m } = taipeiMinute(sec)
    bars.push({
      date,
      m,
      o: finiteOf(data.o?.[i]) ?? c,
      h: finiteOf(data.h?.[i]) ?? c,
      l: finiteOf(data.l?.[i]) ?? c,
      c,
      v: finiteOf(data.v?.[i]) ?? 0,
    })
  }
  const q = data.quote ?? {}
  const quote: ExternalQuote = {
    name: typeof q['200009'] === 'string' ? (q['200009'] as string) : null,
    price: finiteOf(q['6']),
    high: finiteOf(q['12']),
    low: finiteOf(q['13']),
    prev: finiteOf(q['21']),
    limitUp: finiteOf(q['75']),
    limitDown: finiteOf(q['76']),
    volume: finiteOf(q['800001']),
  }
  return { bars, quote }
}

type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[]
      indicators?: {
        quote?: {
          open?: (number | null)[]
          high?: (number | null)[]
          low?: (number | null)[]
          close?: (number | null)[]
          volume?: (number | null)[]
        }[]
      }
    }[]
  }
}

/** Yahoo 一分K（成交量是股，換成張） */
async function fetchYahooMinutes(symbol: string, market: 'twse' | 'tpex') {
  const suffix = market === 'tpex' ? 'TWO' : 'TW'
  const json = await getJsonFrom<YahooChart>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.${suffix}`)}?interval=1m&range=1d&includePrePost=false`,
    'https://finance.yahoo.com/',
  )
  const result = json.chart?.result?.[0]
  const times = result?.timestamp ?? []
  const q = result?.indicators?.quote?.[0]
  const bars: DatedBar[] = []
  for (let i = 0; i < times.length; i++) {
    const c = finiteOf(q?.close?.[i])
    if (c == null) continue
    const { date, m } = taipeiMinute(Number(times[i]))
    bars.push({
      date,
      m,
      o: finiteOf(q?.open?.[i]) ?? c,
      h: finiteOf(q?.high?.[i]) ?? c,
      l: finiteOf(q?.low?.[i]) ?? c,
      c,
      v: (finiteOf(q?.volume?.[i]) ?? 0) / 1000,
    })
  }
  return bars
}

async function loadExternalDay(symbol: string, market: 'twse' | 'tpex'): Promise<ExternalDay | null> {
  const [cnyes, yahoo] = await Promise.all([
    fetchCnyesMinutes(symbol, market).catch(() => null),
    fetchYahooMinutes(symbol, market).catch(() => [] as DatedBar[]),
  ])
  const cnyesBars = cnyes?.bars ?? []
  const date = [...cnyesBars, ...yahoo].reduce((best, bar) => (bar.date > best ? bar.date : best), '')
  if (!date) return cnyes ? { date: '', bars: [], cnyes: 0, yahoo: 0, quote: cnyes.quote } : null
  // 以分鐘對齊：鉅亨優先，鉅亨缺的分鐘用 Yahoo 補
  const byMinute = new Map<number, MinuteBar>()
  const strip = ({ m, o, h, l, c, v }: DatedBar): MinuteBar => ({ m, o, h, l, c, v })
  for (const bar of yahoo) if (bar.date === date && inSparkSession(bar.m)) byMinute.set(bar.m, strip(bar))
  let fromCnyes = 0
  for (const bar of cnyesBars) {
    if (bar.date !== date || !inSparkSession(bar.m)) continue
    byMinute.set(bar.m, strip(bar))
    fromCnyes++
  }
  return {
    date,
    bars: [...byMinute.values()].sort((a, b) => a.m - b.m),
    cnyes: fromCnyes,
    yahoo: Math.max(0, byMinute.size - fromCnyes),
    quote: cnyes?.quote ?? null,
  }
}

const externalCache = new Map<string, { at: number; value: ExternalDay | null; pending?: Promise<ExternalDay | null> }>()

/** 外部一分K每檔快取 30 秒，同時多個請求共用同一次抓取 */
async function externalDay(symbol: string, market: 'twse' | 'tpex') {
  const key = `${symbol}:${market}`
  const hit = externalCache.get(key)
  if (hit && Date.now() - hit.at < EXTERNAL_TTL_MS) return hit.value
  if (hit?.pending) return hit.pending
  const pending = (async () => {
    let value: ExternalDay | null = null
    try {
      value = await loadExternalDay(symbol, market)
      if (!value?.bars.length) {
        const other = await loadExternalDay(symbol, market === 'twse' ? 'tpex' : 'twse')
        if (other?.bars.length) value = other
      }
    } catch {
      value = null
    }
    const keep = value?.bars.length ? value : (hit?.value ?? value)
    externalCache.set(key, { at: Date.now(), value: keep })
    return keep
  })()
  externalCache.set(key, { at: hit?.at ?? 0, value: hit?.value ?? null, pending })
  return pending
}

/** 一分K估內外盤：收盤越靠近最高，外盤越多；平盤各半（同參考程式 split_by_close） */
function splitByClose(bar: MinuteBar): [number, number] {
  const volume = bar.v > 0 ? bar.v : 0
  const span = bar.h - bar.l
  if (volume <= 0 || !(span > 0)) return [volume / 2, volume / 2]
  const outer = Math.min(Math.max((volume * (bar.c - bar.l)) / span, 0), volume)
  return [outer, volume - outer]
}

/** 13:25 起收盤集合競價（試撮），這段不算買賣力 */
const CLOSE_AUCTION = 13 * 60 + 25

type DayReference = { date: string; prev: number | null; limitUp: number | null; limitDown: number | null; official: boolean; open: number | null }

/** 每檔每個交易日鎖住一次的參考價：昨收、漲停、跌停、開盤，之後來源切換（台新／鉅亨）也不會變 */
const dayReferences = new Map<string, DayReference>()

let lastSparkLive: SparkLiveFile | null = null

/** 台股升降單位（同參考程式 tickSize） */
function tickSize(price: number) {
  if (price < 10) return 0.01
  if (price < 50) return 0.05
  if (price < 100) return 0.1
  if (price < 500) return 0.5
  if (price < 1000) return 1
  return 5
}

function roundToTick(price: number, direction: 1 | -1) {
  let value = price
  for (let i = 0; i < 4; i++) {
    const step = tickSize(value)
    value = direction > 0 ? Math.ceil((value - 1e-9) / step) * step : Math.floor((value + 1e-9) / step) * step
  }
  const step = tickSize(value)
  return Number(value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0))
}

function officialBand(prev: number | null, up: number | null, down: number | null) {
  if (prev == null || prev <= 0 || up == null || down == null) return false
  const high = up / prev
  const low = down / prev
  return high >= 1.02 && high <= 1.35 && low >= 0.65 && low <= 0.98
}

function dayReference(
  symbol: string,
  date: string,
  seen: { prev: number | null; limitUp: number | null; limitDown: number | null; open: number | null },
): DayReference {
  const old = dayReferences.get(symbol)
  const ref: DayReference =
    old && old.date === date ? { ...old } : { date, prev: null, limitUp: null, limitDown: null, official: false, open: null }
  if (ref.prev == null && seen.prev != null && seen.prev > 0) ref.prev = seen.prev
  if (!ref.official) {
    if (officialBand(ref.prev, seen.limitUp, seen.limitDown)) {
      // 台新／鉅亨給的官方漲跌停（含槓桿 ETF 的特殊幅度）
      ref.limitUp = seen.limitUp
      ref.limitDown = seen.limitDown
      ref.official = true
    } else if (ref.prev != null && ref.limitUp == null) {
      // 暫時沒有官方值：昨收 ±10% 依升降單位進位，拿到官方值再換一次
      ref.limitUp = roundToTick(ref.prev * 1.1, 1)
      ref.limitDown = roundToTick(ref.prev * 0.9, -1)
    }
  }
  if (ref.open == null && seen.open != null && seen.open > 0) ref.open = seen.open
  if (date) dayReferences.set(symbol, ref)
  return ref
}

function buildSpark(
  symbol: string,
  live: LiveSparkBook | undefined,
  liveDate: string,
  ext: ExternalDay | null,
): SparkBook | null {
  const today = taipeiDate()
  const liveToday = live != null && (liveDate === today || liveDate === today.replace(/-/g, ''))
  const livePoints = liveToday
    ? (live.points ?? []).filter((point) => inSparkSession(stampMinute(point.t)))
    : []
  // 盤中以今天為準；開盤前台新還沒有今天的成交，就顯示外部來源最近一個交易日
  const sessionDate = livePoints.length ? today : ext?.date || (liveToday ? today : '')
  const useLive = liveToday && sessionDate === today
  const extBars = ext && ext.date === sessionDate ? ext.bars : []
  if (!useLive && !extBars.length && !live) return null

  // 股價：台新逐筆點為主；台新沒有點的分鐘，用一分K收盤補
  const covered = new Set(livePoints.map((point) => stampMinute(point.t)))
  const fills = extBars.filter((bar) => !covered.has(bar.m)).map((bar) => ({ t: hms(bar.m), p: bar.c }))
  const merged = [...livePoints, ...fills].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
  // 沒有成交的分鐘（冷門股、ETF 常見：台新沒逐筆、一分K也不出那根）沿用上一筆價，線才不會斷
  const points: SparkPoint[] = []
  const carried = new Set<number>()
  // 開盤後幾分鐘才第一筆成交：09:00 起先用第一筆（即開盤價）撐住，線從 09:00 開始
  const first = merged[0]
  if (first) {
    for (let m = SPARK_OPEN; m < stampMinute(first.t) && inSparkSession(m); m++) {
      points.push({ t: hms(m), p: first.p })
      carried.add(m)
    }
  }
  for (const point of merged) {
    const prev = points.at(-1)
    if (prev) {
      for (let m = stampMinute(prev.t) + 1; m < stampMinute(point.t); m++) {
        if (!inSparkSession(m)) continue
        points.push({ t: hms(m), p: prev.p })
        carried.add(m)
      }
    }
    points.push(point)
  }

  // 買賣力（同參考程式 apply_flow／split_by_close）：每根一分K（鉅亨優先、Yahoo 補）依收盤落在高低區間的位置
  // 拆成外盤／內盤，逐分累積。台新逐筆的內外盤判定跟參考程式出入很大，13:25 後還會把收盤試撮量算進來，
  // 所以只在完全抓不到一分K時才退回台新每分鐘外內盤（並排除 13:25–13:29 試撮）。
  const flow: SparkFlow[] = []
  const force: SparkForce[] = []
  let cum = 0
  let taishinMinutes = 0
  let estMinutes = 0
  const pushFlow = (m: number, pair: [number, number], src: SparkFlow['src']) => {
    cum += pair[0] - pair[1]
    flow.push({ t: hms(m), out: Math.round(pair[0] * 10) / 10, inn: Math.round(pair[1] * 10) / 10, src })
    force.push({ t: hms(m), d: Math.round(cum) })
  }
  if (extBars.length) {
    for (const bar of extBars) {
      if (!inSparkSession(bar.m)) continue
      pushFlow(bar.m, splitByClose(bar), 'est')
      estMinutes++
    }
  } else if (useLive) {
    const rows = Object.entries(live?.minutes ?? {})
      .map(([key, pair]) => [stampMinute(key), pair] as const)
      .filter(([m]) => inSparkSession(m) && !(m >= CLOSE_AUCTION && m < SPARK_CLOSE))
      .sort((a, b) => a[0] - b[0])
    for (const [m, pair] of rows) {
      pushFlow(m, [pair[0], pair[1]], 'taishin')
      taishinMinutes++
    }
  }

  const q = ext?.quote ?? null
  const meta = useLive ? live : undefined
  const lastPoint = points.at(-1)
  const ref = dayReference(symbol, sessionDate, {
    prev: meta?.prev ?? q?.prev ?? null,
    limitUp: meta?.limitUp ?? q?.limitUp ?? null,
    limitDown: meta?.limitDown ?? q?.limitDown ?? null,
    open: meta?.open ?? (extBars[0] && extBars[0].m <= SPARK_OPEN + 5 ? extBars[0].o : null) ?? livePoints[0]?.p ?? null,
  })
  return {
    symbol,
    name: live?.name || q?.name || symbol,
    limitUp: ref.limitUp,
    limitDown: ref.limitDown,
    open: ref.open,
    price: meta?.price ?? q?.price ?? lastPoint?.p ?? null,
    prev: ref.prev,
    bid: meta?.bid ?? null,
    ask: meta?.ask ?? null,
    high: meta?.high ?? q?.high ?? null,
    low: meta?.low ?? q?.low ?? null,
    volume: meta?.volume ?? q?.volume ?? null,
    time: meta?.time || lastPoint?.t || '',
    bias: Math.round(cum),
    points,
    force,
    flow,
    forceDate: sessionDate || undefined,
    sources: {
      taishinPoints: livePoints.length,
      filledPoints: fills.length,
      carriedPoints: carried.size,
      taishinMinutes,
      estMinutes,
      cnyesBars: ext?.cnyes ?? 0,
      yahooBars: ext?.yahoo ?? 0,
    },
  }
}
async function loadKey() {
  if (process.env.XAI_API_KEY?.trim()) return process.env.XAI_API_KEY.trim()
  try {
    const text = await readFile(keyFile, 'utf8')
    return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? ''
  } catch {
    return ''
  }
}

async function closesOf(symbol: string) {
  const json = JSON.parse(
    await getText(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.TW?interval=1d&range=1y`,
    ),
  ) as {
    chart?: { result?: { indicators?: { quote?: { close?: (number | null)[] }[] } }[] }
  }
  return (json.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(
    (value): value is number => value != null && value > 0,
  )
}

async function rankWinRates(extra: { symbol: string; name: string }[]) {
  const cached = await readJson<{ at: string; rows: WinPick[] }>(winFile)
  if (cached && Date.now() - new Date(cached.at).getTime() < 12 * 3600 * 1000) {
    return cached.rows
  }
  const book = new Map<string, string>()
  for (const item of [...LIQUID, ...extra]) book.set(item.symbol, item.name)
  const rows: WinPick[] = []
  const list = [...book.entries()]
  for (let i = 0; i < list.length; i += 4) {
    const batch = list.slice(i, i + 4)
    const found = await Promise.all(
      batch.map(async ([symbol, name]) => {
        try {
          const closes = await closesOf(symbol)
          const sample = closes.slice(-121)
          let hit = 0
          let n = 0
          for (let k = 0; k < sample.length - 1; k++) {
            n += 1
            if (sample[k + 1] > sample[k]) hit += 1
          }
          if (n < 40) return null
          return { symbol, name, winRate: hit / n, samples: n } satisfies WinPick
        } catch {
          return null
        }
      }),
    )
    rows.push(...found.filter((row): row is WinPick => row != null))
  }
  rows.sort((a, b) => b.winRate - a.winRate)
  await writeJson(winFile, { at: new Date().toISOString(), rows })
  return rows
}

function ruleReport(
  snapshot: CacheShape,
  quotes: QuoteRow[],
  highWin: WinPick[],
  note?: string,
): DeskReport {
  const down = (snapshot.index.pct ?? 0) < -0.4 || (snapshot.institutions.foreign ?? 0) < 0
  const stance = down ? '偏防守' : '中性偏多'
  const summary = down
    ? '大盤收跌或外資賣超時，優先降低槓桿與追高節奏，改以分批布局優質標的。'
    : '大盤與外資沒有明顯轉弱，回檔可分批，仍要守住個股停損。'
  const stocks = quotes.map((quote) => {
    const pct = quote.pct ?? 0
    const weak = pct <= -1
    return {
      symbol: quote.symbol,
      name: quote.name,
      action: weak ? '觀望／設停損' : pct >= 0.4 ? '持有／逢回加碼觀察' : '持有／觀察',
      detail: weak
        ? `今日 ${pct.toFixed(2)}%，先看是否跌破開盤與昨收。`
        : `今日 ${pct.toFixed(2)}%，沿五日線分批，跌破就減碼。`,
    }
  })
  const strong = [...quotes].filter((quote) => (quote.pct ?? -1) > 0).slice(0, 3)
  return {
    generatedAt: new Date().toISOString(),
    engine: 'rules',
    stance,
    summary,
    stocks,
    satellite: strong.map((quote) => ({
      symbol: quote.symbol,
      name: quote.name,
      action: '衛星',
      detail: '報價列表中相對強勢，只做確認過的方向，嚴格停損。',
    })),
    highWin: highWin.slice(0, 6),
    marketBullets: [
      snapshot.index.price != null
        ? `加權指數 ${snapshot.index.price.toLocaleString('zh-TW')}，漲跌 ${snapshot.index.pct?.toFixed(2)}%`
        : '加權指數尚無資料',
      snapshot.institutions.foreign != null
        ? `外資 ${(snapshot.institutions.foreign / 1e8).toFixed(1)} 億、投信 ${((snapshot.institutions.trust ?? 0) / 1e8).toFixed(1)} 億、自營商 ${((snapshot.institutions.dealer ?? 0) / 1e8).toFixed(1)} 億`
        : '三大法人尚無資料',
    ],
    structure: ['衛星只放相對強勢且量能配合的標的，嚴格停損。'],
    note,
  }
}

async function grokReport(
  snapshot: CacheShape,
  quotes: QuoteRow[],
  highWin: WinPick[],
) {
  const key = await loadKey()
  if (!key) {
    return ruleReport(
      snapshot,
      quotes,
      highWin,
      '尚未設定 Grok API 金鑰。請把金鑰寫入 data/xai-key.txt 後再按產生／更新報告。下面先用規則引擎。',
    )
  }
  const payload = {
    macro: {
      index: snapshot.index,
      institutions: snapshot.institutions,
      sectors: [...snapshot.sectors].sort((a, b) => b.pct - a.pct).slice(0, 5).concat(
        [...snapshot.sectors].sort((a, b) => a.pct - b.pct).slice(0, 5),
      ),
      gold: snapshot.gold,
      brent: snapshot.brent,
    },
    quotes,
    highWin: highWin.slice(0, 8),
  }
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-4.7',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是台灣股票的專業投資經理。只用使用者提供的數字，不要編造沒有的總經數據。用繁體中文，輸出 JSON，不要 Markdown。格式：{"stance":"","summary":"","stocks":[{"symbol":"","name":"","action":"","detail":""}],"satellite":[{"symbol":"","name":"","action":"衛星","detail":""}],"structure":[""],"marketBullets":[""]}。stocks 涵蓋報價列表每一檔。satellite 從 highWin 與報價列表挑相對高勝率、量能配合的標的，並寫明停損。stance 用偏多、中性或偏防守。',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    return ruleReport(snapshot, quotes, highWin, `Grok 沒有完成（${res.status}）。${text.slice(0, 180)}`)
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = json.choices?.[0]?.message?.content ?? ''
  const matched = content.match(/\{[\s\S]*\}/)
  if (!matched) return ruleReport(snapshot, quotes, highWin, 'Grok 沒有回傳報告，已改用規則引擎。')
  const parsed = JSON.parse(matched[0]) as Partial<DeskReport>
  const report: DeskReport = {
    generatedAt: new Date().toISOString(),
    engine: 'grok',
    stance: parsed.stance || '中性',
    summary: parsed.summary || '',
    stocks: parsed.stocks ?? [],
    satellite: parsed.satellite ?? [],
    highWin: highWin.slice(0, 6),
    marketBullets: parsed.marketBullets ?? [],
    structure: parsed.structure ?? [],
  }
  return report
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function attachBoard(middlewares: {
  use: (
    fn: (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}) {
  if (!timer) {
    void (async () => {
      memory = await readJson<CacheShape>(macroFile)
      reportMemory = await readJson<DeskReport>(reportFile)
      tickerMemory = await readJson<TickerCache>(tickerFile)
      if (stale(memory)) void scanMacro()
      maybeRefreshTicker()
      maybeRefreshSectors()
      await startTaishinFeed()
    })()
    timer = setInterval(() => {
      if (stale(memory)) void scanMacro()
      maybeRefreshTicker()
      maybeRefreshSectors()
    }, 60_000)
    timer.unref?.()
  }

  middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/board')) {
      next()
      return
    }
    try {
      if (url.pathname === '/api/board/snapshot' && req.method === 'GET') {
        maybeRefreshSectors()
        const snapshot = memory ?? (await readJson<CacheShape>(macroFile)) ?? emptySnapshot()
        const report = reportMemory ?? (await readJson<DeskReport>(reportFile))
        send(res, 200, { ...snapshot, scanning, report, schedule: SLOTS })
        return
      }
      if (url.pathname === '/api/board/refresh' && req.method === 'POST') {
        const snapshot = await scanMacro()
        send(res, 200, snapshot)
        return
      }
      if (url.pathname === '/api/board/live' && req.method === 'GET') {
        send(res, 200, await taishinLiveStatus())
        return
      }
      if (url.pathname === '/api/board/quotes' && req.method === 'GET') {
        const raw = url.searchParams.get('items') ?? ''
        const items = raw
          .split(',')
          .map((part) => {
            const [symbol, market] = part.split(':')
            if (!symbol) return null
            return { symbol, market: market === 'tpex' ? 'tpex' as const : 'twse' as const }
          })
          .filter((item): item is { symbol: string; market: 'twse' | 'tpex' } => item != null)
        await rememberSparkWatch(items.map((item) => item.symbol.toUpperCase()).filter((symbol) => /^[0-9A-Z]{4,6}$/.test(symbol)))
        send(res, 200, await fetchQuotesPreferTaishin(items))
        return
      }
      if (url.pathname === '/api/board/spark' && req.method === 'GET') {
        const wanted = sparkItems(url.searchParams.get('items') ?? '')
        await rememberSparkWatch(wanted.map((item) => item.symbol))
        // 台新 bridge 正在寫檔時偶爾讀到半個 JSON：沿用上一份，不讓這一輪掉回外部來源
        const fresh = await readJson<SparkLiveFile>(sparkLiveFile)
        if (fresh) lastSparkLive = fresh
        const saved = fresh ?? lastSparkLive
        const live = (saved?.symbols ?? {}) as Record<string, LiveSparkBook>
        const books = await Promise.all(
          wanted.map(async (item) =>
            buildSpark(
              item.symbol,
              live[item.symbol],
              saved?.date ?? '',
              await externalDay(item.symbol, item.market).catch(() => null),
            ),
          ),
        )
        send(res, 200, books.filter((book): book is SparkBook => book != null))
        return
      }
      if (url.pathname === '/api/board/ticker' && req.method === 'GET') {
        const stocks = parseTickerStocks(url.searchParams.get('items') ?? '')
        const current = tickerMemory ?? { updatedAt: null, items: [], stocks: [] }
        if (stocks.length && !sameStocks(current.stocks, stocks)) {
          tickerMemory = { ...current, stocks }
          await writeJson(tickerFile, tickerMemory)
          maybeRefreshTicker()
        }
        const visible = new Set(stocks.map((stock) => stock.symbol))
        const items = (tickerMemory?.items ?? []).filter(
          (item) => item.kind !== 'stock' || (item.symbol != null && visible.has(item.symbol)),
        )
        send(res, 200, items)
        return
      }
      if (url.pathname === '/api/board/intraday' && req.method === 'GET') {
        const symbol = url.searchParams.get('symbol') ?? ''
        const market = url.searchParams.get('market') === 'tpex' ? 'tpex' : 'twse'
        if (!/^\d{4,6}[A-Z]?$/.test(symbol)) {
          send(res, 400, { error: '代號不正確' })
          return
        }
        send(res, 200, await fetchIntraday(symbol, market))
        return
      }
      if (url.pathname === '/api/board/insight' && req.method === 'GET') {
        const { bundle, fromCache } = await getInsightBundle(url.searchParams.get('force') === '1')
        send(res, 200, {
          ...bundle,
          fromCache,
          report: await readInsightReport(),
          llm: { configured: Boolean(await loadKey()) },
        })
        return
      }
      if (url.pathname === '/api/board/insight/report' && req.method === 'POST') {
        const body = await readBody(req)
        const items = sparkItems(String(body.items ?? ''))
        const quotes = items.length ? await fetchQuotesPreferTaishin(items) : []
        const saved = await readSparkLiveFile()
        const today = saved?.date === taipeiDate()
        const live = saved?.symbols ?? {}
        const rows = quotes.map((quote) => {
          const book = liveBook(live, quote.symbol)
          const taishin = today && book?.price != null
          return { quote, taishin, force: taishin && book ? book.bias : null }
        })
        const key = body.preferLlm === false ? '' : await loadKey()
        send(res, 200, await makeInsightReport(rows, key))
        return
      }
      if (url.pathname === '/api/board/report' && req.method === 'POST') {
        const body = await readBody(req)
        const quotes = Array.isArray(body.quotes) ? (body.quotes as QuoteRow[]) : []
        const snapshot = memory ?? (await readJson<CacheShape>(macroFile)) ?? emptySnapshot()
        const extra = quotes.map((quote) => ({ symbol: quote.symbol, name: quote.name }))
        const wins = await rankWinRates(extra)
        const report = await grokReport(snapshot, quotes, wins)
        reportMemory = report
        await writeJson(reportFile, report)
        send(res, 200, report)
        return
      }
      send(res, 404, { error: '找不到' })
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : '伺服器錯誤' })
    }
  })
}

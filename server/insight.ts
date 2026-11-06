import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type {
  InsightBar,
  InsightBundle,
  InsightCard,
  InsightHolding,
  InsightIdea,
  InsightMetric,
  InsightParty,
  InsightReport,
  InsightTone,
  MarginSnapshot,
  OverlayPoint,
  RetailPoint,
  QuoteRow,
} from '../src/desk/types.ts'

// 分析頁資料：版型對齊 OneWebStock 的 insight 頁。
// 台新（報價列表即時價、逐筆買賣力）用在操作建議；台新沒有的總經、維持率、法人、期貨才走官方／公開來源。

const dataDir = path.join(process.cwd(), 'data')
const bundleFile = path.join(dataDir, 'insight-bundle.json')
const reportFile = path.join(dataDir, 'insight-report.json')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

export type InsightQuote = { quote: QuoteRow; force: number | null; taishin: boolean }

async function fetchBuf(url: string, referer: string, headers: Record<string, string> = {}, timeout = 25000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: referer, ...headers },
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function fetchJson<T>(url: string, referer: string, headers: Record<string, string> = {}, timeout = 25000) {
  return JSON.parse((await fetchBuf(url, referer, headers, timeout)).toString('utf8')) as T
}

function num(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const text = String(raw).replace(/[,%\s]/g, '').replace(/^\+/, '')
  if (!text || text === '-' || text === '--') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function fixed(value: number, digits: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function signed(value: number | null | undefined, digits: number) {
  if (value == null) return '—'
  const text = fixed(value, digits)
  return value > 0 ? `+${text}` : text
}

function toneOf(value: number | null | undefined): InsightTone {
  if (value == null || Math.abs(value) < 1e-9) return 'flat'
  return value > 0 ? 'up' : 'down'
}

function movement(value: number | null | undefined) {
  if (!value) return '持平'
  return value > 0 ? '上升' : '下跌'
}

const monthLabel = (year: number, month: number) => `${year}年${month}月`

function isoOf(raw: string) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : ''
}

function rocIso(raw: string) {
  const parts = String(raw ?? '').trim().split('/')
  if (parts.length !== 3) return ''
  const year = Number(parts[0]) + 1911
  return `${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
}

function dayLabel(iso: string) {
  if (iso.length < 10) return iso
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
}

function slashLabel(iso: string) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
}

function taipeiStamp(now = new Date()) {
  return now.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 19)
}

function taipeiParts(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(now))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hm: `${hour}:${get('minute')}`,
    weekday: get('weekday'),
  }
}

/** 從「11月5日」還原今年的 ISO 日期（跨年邊界用當下年份） */
function periodToIso(period: string | undefined, today: string) {
  const match = String(period ?? '').match(/(\d{1,2})月(\d{1,2})日/)
  if (!match) return ''
  const year = Number(today.slice(0, 4))
  return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

function marketAsOf(bundle: InsightBundle | null) {
  const card = bundle?.cards.find((row) => row.id === 'market')
  if (!card) return ''
  if (card.asOf) return card.asOf
  return periodToIso(card.period, taipeiParts().date)
}


function metric(partial: Partial<InsightMetric> & Pick<InsightMetric, 'id' | 'title' | 'source'>): InsightMetric {
  return {
    value: '—',
    period: '',
    detail: '',
    detailTone: 'flat',
    status: '',
    tone: 'flat',
    note: '',
    ...partial,
  }
}

function missing(id: string, title: string, source: string, reason: unknown): InsightMetric {
  const text = reason instanceof Error ? reason.message : String(reason ?? '')
  return metric({ id, title, source, detail: '—', status: '暫缺', note: text.slice(0, 80) })
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

async function fetchIsm() {
  const html = (
    await fetchBuf('https://tradingeconomics.com/united-states/business-confidence', 'https://tradingeconomics.com/')
  ).toString('utf8')
  const found = html.match(
    /to ([0-9]+(?:\.[0-9]+)?) points in ([A-Za-z]+) from ([0-9]+(?:\.[0-9]+)?) points in ([A-Za-z]+) of (20[0-9]{2})/i,
  )
  if (!found) throw new Error('找不到 ISM 最新值')
  const latest = Number(found[1])
  const latestMonth = MONTHS[found[2].toLowerCase()]
  const previous = Number(found[3])
  const previousMonth = MONTHS[found[4].toLowerCase()]
  const year = Number(found[5])
  if (!latestMonth || !previousMonth) throw new Error('ISM 月份讀不懂')
  const latestYear = latestMonth >= previousMonth ? year : year + 1
  const delta = latest - previous
  return metric({
    id: 'ism',
    title: '美國 ISM 製造業',
    source: 'Trading Economics',
    href: 'https://tradingeconomics.com/united-states/business-confidence',
    value: latest.toFixed(1),
    asOf: `${latestYear}-${String(latestMonth).padStart(2, '0')}`,
    period: monthLabel(latestYear, latestMonth),
    detail: signed(delta, 1),
    detailTone: toneOf(delta),
    status: latest >= 50 ? '擴張' : '收縮',
    tone: latest >= 50 ? 'up' : 'down',
  })
}

async function fetchSahm() {
  const json = await fetchJson<{
    Results?: { series?: { data?: { year: string; period: string; value: string }[] }[] }
  }>('https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000', 'https://www.bls.gov/')
  const rows = json.Results?.series?.[0]?.data ?? []
  const rates = [...rows].reverse().flatMap((row) => {
    const value = num(row.value)
    if (value == null || !String(row.period).startsWith('M')) return []
    return [{ year: Number(row.year), month: Number(row.period.slice(1)), value }]
  })
  const averages: (number | null)[] = []
  const sahm: { year: number; month: number; value: number }[] = []
  rates.forEach((row, i) => {
    if (i < 2) {
      averages.push(null)
      return
    }
    const average = (rates[i - 2].value + rates[i - 1].value + row.value) / 3
    averages.push(average)
    const window = averages.slice(Math.max(0, i - 12), i).filter((v): v is number => v != null)
    if (window.length < 12) return
    sahm.push({ year: row.year, month: row.month, value: average - Math.min(...window) })
  })
  const last = sahm[sahm.length - 1]
  if (!last) throw new Error('失業率歷史不足以計算薩姆規則')
  const prev = sahm.length > 1 ? sahm[sahm.length - 2].value : null
  const delta = prev == null ? null : last.value - prev
  const [status, tone]: [string, InsightTone] =
    last.value >= 0.5 ? ['衰退訊號', 'alert'] : last.value >= 0.3 ? ['接近門檻', 'flat'] : ['未觸發', 'down']
  return metric({
    id: 'sahm',
    title: '薩姆規則',
    source: 'BLS 失業率',
    href: 'https://www.bls.gov/cps/',
    value: (Math.abs(last.value) < 0.005 ? 0 : last.value).toFixed(2),
    asOf: `${last.year}-${String(last.month).padStart(2, '0')}`,
    period: monthLabel(last.year, last.month),
    detail: signed(delta, 2),
    detailTone: toneOf(delta),
    status,
    tone,
  })
}

function unzip(buf: Buffer) {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('景氣燈號壓縮檔格式不對')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out: { name: string; data: Buffer }[] = []
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null
    if (data) out.push({ name, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function csvRows(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  const split = (line: string) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
  const head = split(lines[0] ?? '')
  return lines.slice(1).map((line) => {
    const cells = split(line)
    return Object.fromEntries(head.map((name, i) => [name, cells[i] ?? ''])) as Record<string, string>
  })
}

const LIGHTS: Record<string, [string, InsightTone]> = {
  紅: ['紅燈', 'red'],
  黃紅: ['黃紅燈', 'yellow-red'],
  綠: ['綠燈', 'green'],
  黃藍: ['黃藍燈', 'yellow-blue'],
  藍: ['藍燈', 'blue'],
}

async function fetchLights() {
  const catalog = await fetchJson<{ result?: { distribution?: { resourceDownloadUrl?: string }[] } }>(
    'https://data.gov.tw/api/v2/rest/dataset/6099',
    'https://data.gov.tw/',
  )
  const url = catalog.result?.distribution?.find((item) => item.resourceDownloadUrl)?.resourceDownloadUrl
  if (!url) throw new Error('找不到景氣燈號資料')
  const files = unzip(await fetchBuf(url, 'https://data.gov.tw/'))
  const text = files
    .filter((file) => !file.name.toLowerCase().startsWith('schema'))
    .map((file) => file.data.toString('utf8'))
    .find((body) => body.includes('景氣對策信號綜合分數'))
  if (!text) throw new Error('景氣燈號檔案裡沒有燈號')
  const parsed = csvRows(text).flatMap((row) => {
    const digits = String(row.Date ?? '').replace(/\D/g, '')
    const score = num(row['景氣對策信號綜合分數'])
    if (digits.length < 6 || score == null) return []
    return [{ year: Number(digits.slice(0, 4)), month: Number(digits.slice(4, 6)), score, signal: String(row['景氣對策信號'] ?? '').trim() }]
  })
  const last = parsed[parsed.length - 1]
  if (!last) throw new Error('景氣燈號是空的')
  const [name, tone] = LIGHTS[last.signal.replace(/燈$/, '')] ?? ['—', 'flat' as InsightTone]
  return metric({
    id: 'light',
    title: '景氣燈號',
    source: '國發會',
    href: 'https://data.gov.tw/dataset/6099',
    asOf: `${last.year}-${String(last.month).padStart(2, '0')}`,
    value: last.score.toFixed(0),
    period: monthLabel(last.year, last.month),
    status: name,
    tone,
    lamp: true,
  })
}

async function fetchExports() {
  // 關務署開放資料慢一個月。財政部統計處的初步統計才是對外公布的出口年增率（美元計）
  const html = (
    await fetchBuf(
      'https://www.mof.gov.tw/txtStatistics/5a74f75c9e704b16ad32a41625b20faa',
      'https://www.mof.gov.tw/',
    )
  ).toString('utf8')
  const found = html.match(/(\d+)年(\d+)月出口[\s\S]{0,500}?與上年同期比較：[\s\S]{0,160}?(-?\d+(?:\.\d+)?)%/)
  if (!found) throw new Error('找不到出口年增率')
  const year = Number(found[1]) + 1911
  const month = Number(found[2])
  const pct = Number(found[3])
  return metric({
    id: 'export',
    title: '台灣出口年增率',
    source: '財政部統計處',
    href: 'https://www.mof.gov.tw/txtStatistics/5a74f75c9e704b16ad32a41625b20faa',
    asOf: `${year}-${String(month).padStart(2, '0')}`,
    value: `${signed(pct, 1)}%`,
    period: monthLabel(year, month),
    status: pct >= 0 ? '成長' : '衰退',
    tone: toneOf(pct),
  })
}

type CnbcQuote = { symbol?: string; last?: string; change?: string; change_pct?: string; last_time?: string }

async function fetchCnbc() {
  const symbols = ['.BADI', '@LCO.1', '@GC.1']
  const json = await fetchJson<{ FormattedQuoteResult?: { FormattedQuote?: CnbcQuote[] } }>(
    'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
      encodeURIComponent(symbols.join('|')) +
      '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1',
    'https://www.cnbc.com/',
  )
  const rows = json.FormattedQuoteResult?.FormattedQuote ?? []
  const pick = (symbol: string, id: string, title: string, digits: number) => {
    const item = rows.find((row) => row.symbol === symbol)
    const last = num(item?.last)
    if (!item || last == null) return missing(id, title, 'CNBC', `找不到 ${title}`)
    const change = num(item.change)
    const pct = num(item.change_pct)
    const when = String(item.last_time ?? '').slice(0, 10)
    return metric({
      id,
      title,
      source: 'CNBC',
      href: `https://www.cnbc.com/quotes/${encodeURIComponent(symbol)}`,
      asOf: when.length === 10 ? when : '',
      value: fixed(last, digits),
      period: when.length === 10 ? dayLabel(when) : when,
      detail: `${signed(change, digits)}${pct != null ? ` ${signed(pct, 2)}%` : ''}`,
      detailTone: toneOf(change),
      status: movement(change),
      tone: toneOf(change),
    })
  }
  return {
    bdi: pick('.BADI', 'bdi', 'BDI 乾散貨', 0),
    brent: pick('@LCO.1', 'brent', '布蘭特原油', 2),
    gold: pick('@GC.1', 'gold', '黃金', 1),
  }
}

async function fetchBai() {
  const json = await fetchJson<{
    results?: {
      routes?: {
        code?: string
        index_value?: { price?: number; date?: string; change_1w?: { absolute?: number; percentage?: number } }
      }[]
    }[]
  }>('https://api.tacindex.com/bai/?currency=USD', 'https://dashboard.tacindex.com/', {
    Origin: 'https://dashboard.tacindex.com',
  })
  const route = (json.results ?? []).flatMap((group) => group.routes ?? []).find((item) => item.code === 'BAI00')
  const value = route?.index_value
  const last = num(value?.price)
  if (last == null) throw new Error('找不到 BAI')
  const change = num(value?.change_1w?.absolute)
  const pct = num(value?.change_1w?.percentage)
  const when = String(value?.date ?? '')
  return metric({
    id: 'bai',
    title: 'BAI 空運',
    source: 'TAC Index',
    href: 'https://dashboard.tacindex.com/',
    asOf: when.length >= 10 ? when.slice(0, 10) : '',
    value: fixed(last, 0),
    period: when.length >= 10 ? dayLabel(when.slice(0, 10)) : when,
    detail: `${signed(change, 0)}${pct != null ? ` ${signed(pct, 1)}%` : ''}`,
    detailTone: toneOf(change),
    status: movement(change),
    tone: toneOf(change),
  })
}

type TaiexDay = { date: string; close: number; change: number | null }

async function fetchTaiexSeries(months = 5) {
  const now = new Date(Date.now() + 8 * 3600_000)
  let year = now.getUTCFullYear()
  let month = now.getUTCMonth() + 1
  const days = new Map<string, TaiexDay>()
  for (let i = 0; i < months; i++) {
    const stamp = `${year}${String(month).padStart(2, '0')}01`
    try {
      const json = await fetchJson<{ stat?: string; data?: string[][] }>(
        `https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date=${stamp}`,
        'https://www.twse.com.tw/',
      )
      if (json.stat === 'OK') {
        for (const row of json.data ?? []) {
          const date = rocIso(row[0])
          const close = num(row[4])
          if (date && close != null) days.set(date, { date, close, change: num(row[5]) })
        }
      }
    } catch {
      // 某個月抓不到就略過，圖會少一段而不是整張壞掉
    }
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchInstitutions() {
  const json = await fetchJson<{ stat?: string; date?: string; data?: string[][] }>(
    'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json',
    'https://www.twse.com.tw/',
  )
  const find = (label: string) => num(json.data?.find((row) => String(row[0]).trim() === label)?.[3])
  const foreign = (find('外資及陸資(不含外資自營商)') ?? 0) + (find('外資自營商') ?? 0)
  const trust = find('投信')
  const dealer = (find('自營商(自行買賣)') ?? 0) + (find('自營商(避險)') ?? 0)
  const party = (name: string, value: number | null): InsightParty => ({
    name,
    text: value == null ? '—' : `${signed(value / 1e8, 1)}億`,
    tone: toneOf(value),
  })
  const iso = isoOf(json.date ?? '')
  return {
    date: iso,
    dateLabel: iso ? dayLabel(iso) : '',
    items: [party('外資', foreign), party('投信', trust), party('自營商', dealer)],
  }
}

async function fetchDerivatives() {
  const now = new Date(Date.now() + 8 * 3600_000)
  const slash = (d: Date) =>
    `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
  // 期交所的結束日若還沒有資料（盤後未公布、假日）會回 HTML，往前退到有資料的那天
  let text = ''
  for (let back = 0; back < 5 && !text.startsWith('日期'); back++) {
    const end = new Date(now.getTime() - back * 86400_000)
    const start = new Date(end.getTime() - 29 * 86400_000)
    const buf = await fetchBuf(
      `https://www.taifex.com.tw/cht/3/dlFutContractsDateDown?queryStartDate=${slash(start)}&queryEndDate=${slash(end)}`,
      'https://www.taifex.com.tw/',
      {},
      40000,
    )
    text = new TextDecoder('big5').decode(buf)
  }
  if (!text.startsWith('日期')) throw new Error('期交所沒有回傳期貨部位')
  const byDay = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',').map((cell) => cell.trim())
    if (cells.length < 15 || cells[0] === '日期') continue
    if (cells[1] !== '臺股期貨' || !cells[2].startsWith('外資')) continue
    const oiLong = num(cells[9])
    const oiShort = num(cells[11])
    const oiNet = num(cells[13])
    if (oiNet == null || (!oiLong && !oiShort)) continue
    const [y, m, d] = cells[0].split('/')
    byDay.set(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, Math.round(oiNet))
  }
  const days = [...byDay.keys()].sort()
  if (days.length < 2) throw new Error('期貨未平倉資料不足')
  const window = days.slice(-6)
  const bars: InsightBar[] = window.slice(1).map((day, i) => {
    const value = byDay.get(day)! - byDay.get(window[i])!
    return { label: slashLabel(day), value, level: byDay.get(day)!, tone: toneOf(value) }
  })
  return { date: days[days.length - 1], dateLabel: dayLabel(days[days.length - 1]), title: '外資未平倉增減', unit: '口', bars }
}

const MARGIN_LABEL = '大盤融資維持率'
const MARGIN_SOURCE = '證交所'
const MARGIN_BASIS = 'listed-market-value'
const marketFile = path.join(dataDir, 'margin-market.json')

type MarketPoint = { date: string; keepRate: number; balance: number }
type MarketStore = { basis: string; through: string; closes: Record<string, number>; points: MarketPoint[] }
type TwseDoc = { stat?: string; tables?: { title?: string; data?: string[][] }[] }

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 上市大盤融資維持率＝融資股票市值／融資金額。停牌沒有收盤價時沿用上一個交易日 */
async function marginDay(iso: string) {
  const date = iso.replaceAll('-', '')
  const referer = 'https://www.twse.com.tw/'
  const [margin, prices] = await Promise.all([
    fetchJson<TwseDoc>(
      `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${date}&selectType=ALL&response=json`,
      referer,
      {},
      40000,
    ),
    fetchJson<TwseDoc>(
      `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date}&type=ALL&response=json`,
      referer,
      {},
      40000,
    ),
  ])
  if (margin.stat !== 'OK' || prices.stat !== 'OK') return null
  const tables = margin.tables ?? []
  const summary = tables.find((table) => String(table.title ?? '').includes('信用交易'))
  const detail = tables.find((table) => String(table.title ?? '').includes('彙總'))
  const amount = num(summary?.data?.find((row) => String(row[0]).includes('融資金額'))?.[5])
  const quote = (prices.tables ?? []).find((table) => String(table.title ?? '').includes('每日收盤'))
  if (amount == null || !detail?.data || !quote?.data) return null
  const balances = new Map<string, number>()
  for (const row of detail.data) {
    const shares = num(row[6])
    if (shares) balances.set(String(row[0]).trim(), shares)
  }
  const closes = new Map<string, number>()
  for (const row of quote.data) {
    const close = num(row[8])
    if (close != null) closes.set(String(row[0]).trim(), close)
  }
  return { amount, balances, closes }
}

async function loadDay(iso: string) {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await marginDay(iso)
    } catch (error) {
      last = error
      await pause(1000 * (attempt + 1))
    }
  }
  throw last instanceof Error ? last : new Error('上市融資維持率讀取失敗')
}

async function fetchMargin() {
  const taiex = await fetchTaiexSeries(8)
  const lastDay = taiex[taiex.length - 1]?.date
  if (!lastDay) throw new Error('沒有加權交易日')
  const windowStart = shiftDate(lastDay, -183)
  const days = taiex.map((day) => day.date).filter((date) => date >= shiftDate(windowStart, -21))
  const saved = await readJson<MarketStore>(marketFile)
  const store = saved?.basis === MARGIN_BASIS ? saved : null
  const closes = new Map<string, number>(Object.entries(store?.closes ?? {}))
  const points = (store?.points ?? []).filter((point) => point.date >= windowStart && point.date <= (store?.through ?? ''))
  const through = store?.through && points.length ? store.through : ''
  if (through >= lastDay && points.length >= 100 && points[points.length - 1]?.date === lastDay) {
    const last = points[points.length - 1]
    return {
      series: points,
      latest: {
        date: last.date,
        keepRate: last.keepRate,
        balance: last.balance,
        callAccNum: null,
        exeAccNum: null,
        belowAccNum: null,
        marginAccRate: null,
      } satisfies MarginSnapshot,
    }
  }
  const pending: Promise<{ date: string; day: Awaited<ReturnType<typeof loadDay>> }>[] = []
  const queue = days.filter((date) => date > through)
  console.log(`[insight] 上市大盤融資維持率補 ${queue.length} 個交易日`)
  const pump = () => {
    while (pending.length < 2 && queue.length) {
      const date = queue.shift()!
      pending.push(loadDay(date).then((day) => ({ date, day })))
    }
  }
  pump()
  let fetched = 0
  while (pending.length) {
    const { date, day } = await pending.shift()!
    pump()
    if (!day) {
      if (date === lastDay) throw new Error('上市融資維持率還沒公布')
      continue
    }
    for (const [code, price] of day.closes) closes.set(code, price)
    if (date >= windowStart) {
      let marketValue = 0
      for (const [code, shares] of day.balances) {
        const price = closes.get(code)
        if (price == null) continue
        marketValue += price * shares * 1000
      }
      const keepRate = (marketValue / (day.amount * 1000)) * 100
      points.push({ date, keepRate, balance: day.amount / 100_000 })
    }
    fetched += 1
    if (fetched % 8 === 0) {
      await writeJson(marketFile, {
        basis: MARGIN_BASIS,
        through: date,
        closes: Object.fromEntries(closes),
        points,
      } satisfies MarketStore)
      console.log(`[insight] 大盤融資維持率已補到 ${date}，${points.length} 筆`)
    }
    await pause(80)
  }
  const last = points[points.length - 1]
  if (!last || last.date !== lastDay) throw new Error('上市融資維持率還沒公布')
  await writeJson(marketFile, {
    basis: MARGIN_BASIS,
    through: last.date,
    closes: Object.fromEntries(closes),
    points,
  } satisfies MarketStore)
  return {
    series: points,
    latest: {
      date: last.date,
      keepRate: last.keepRate,
      balance: last.balance,
      callAccNum: null,
      exeAccNum: null,
      belowAccNum: null,
      marginAccRate: null,
    } satisfies MarginSnapshot,
  }
}

function overlayOf(
  margin: { date: string; keepRate: number; balance: number | null }[],
  taiex: TaiexDay[],
): OverlayPoint[] {
  const closes = new Map(taiex.map((day) => [day.date, day.close]))
  return margin.map((row) => {
    let taiexClose = closes.get(row.date) ?? null
    if (taiexClose == null) {
      const before = taiex.filter((day) => day.date <= row.date)
      taiexClose = before.length ? before[before.length - 1].close : null
    }
    return { date: row.date, keepRate: row.keepRate, balance: row.balance, taiex: taiexClose }
  })
}

async function postForm(url: string, referer: string, fields: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: referer,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(40000),
  })
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 微台散戶多空比＝（散戶多單−散戶空單）／全市場未平倉。散戶＝全市場扣掉三大法人 */
async function fetchRetail(): Promise<{ asOf: string; points: RetailPoint[] }> {
  const now = new Date(Date.now() + 8 * 3600_000)
  const slash = (d: Date) =>
    `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
  // 行情下載超過約一個月會回錯誤頁；當天未公布也是。一次抓 28 天，往前接三段
  const downloadQuotes = async (start: Date, end: Date) => {
    const buf = await postForm('https://www.taifex.com.tw/cht/3/futDataDown', 'https://www.taifex.com.tw/cht/3/futDailyMarketView', {
      down_type: '1',
      commodity_id: 'TMF',
      commodity_id2: '',
      queryStartDate: slash(start),
      queryEndDate: slash(end),
    })
    const text = new TextDecoder('big5').decode(buf)
    return text.startsWith('交易日期') ? text : ''
  }
  // 三大法人未平倉：結束日若尚未公布（盤後／假日）會回 HTML「日期時間錯誤」，需往前退
  const downloadInst = async (start: Date, end: Date) => {
    const buf = await fetchBuf(
      `https://www.taifex.com.tw/cht/3/dlFutContractsDateDown?queryStartDate=${slash(start)}&queryEndDate=${slash(end)}`,
      'https://www.taifex.com.tw/',
      {},
      40000,
    )
    const text = new TextDecoder('big5').decode(buf)
    return text.startsWith('日期') ? text : ''
  }
  let end = now
  let latest = ''
  for (let back = 0; back < 6 && !latest; back++) {
    end = new Date(now.getTime() - back * 86400_000)
    latest = await downloadQuotes(new Date(end.getTime() - 28 * 86400_000), end)
  }
  if (!latest) throw new Error('期交所沒有微台行情')
  let inst = ''
  for (let back = 0; back < 8 && !inst; back++) {
    const instEnd = new Date(now.getTime() - back * 86400_000)
    inst = await downloadInst(new Date(instEnd.getTime() - 90 * 86400_000), instEnd)
    if (inst) end = instEnd
  }
  if (!inst) throw new Error('期交所沒有微台資料')
  const chunks = [latest]
  for (let i = 1; i < 3; i++) {
    const chunkEnd = new Date(end.getTime() - i * 29 * 86400_000)
    const text = await downloadQuotes(new Date(chunkEnd.getTime() - 28 * 86400_000), chunkEnd)
    if (text) chunks.push(text)
  }
  // 法人成功日可能比行情回補日更早；行情再對齊一次，避免只用「今天」空檔
  const aligned = await downloadQuotes(new Date(end.getTime() - 28 * 86400_000), end)
  const quotes = (aligned || chunks.join('\n'))
  if (!quotes.startsWith('交易日期')) throw new Error('期交所沒有微台資料')
  const oi = new Map<string, number>()
  for (const line of quotes.split(/\r?\n/)) {
    const cells = line.split(',').map((cell) => cell.trim())
    if (cells.length < 18 || cells[0] === '交易日期' || cells[17] !== '一般') continue
    const open = num(cells[11])
    if (open == null) continue
    const [y, m, d] = cells[0].split('/')
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    oi.set(date, (oi.get(date) ?? 0) + open)
  }
  const longs = new Map<string, number>()
  const shorts = new Map<string, number>()
  for (const line of inst.split(/\r?\n/)) {
    const cells = line.split(',').map((cell) => cell.trim())
    if (cells.length < 14 || cells[1] !== '微型臺指期貨') continue
    const who = cells[2]
    if (!who.startsWith('外資') && who !== '投信' && who !== '自營商') continue
    const long = num(cells[9])
    const short = num(cells[11])
    if (long == null || short == null) continue
    const [y, m, d] = cells[0].split('/')
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    longs.set(date, (longs.get(date) ?? 0) + long)
    shorts.set(date, (shorts.get(date) ?? 0) + short)
  }
  const points: RetailPoint[] = [...oi.keys()].sort().flatMap((date) => {
    const total = oi.get(date) ?? 0
    const long = longs.get(date)
    const short = shorts.get(date)
    if (!total || long == null || short == null) return []
    const retailLong = total - long
    const retailShort = total - short
    return [{ date, ratio: ((retailLong - retailShort) / total) * 100 }]
  })
  const last = points[points.length - 1]
  if (!last) throw new Error('微台散戶多空比沒有資料')
  return { asOf: last.date, points }
}

async function readJson<T>(file: string) {
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

function settled<T>(result: PromiseSettledResult<T>, errors: string[], label: string) {
  if (result.status === 'fulfilled') return result.value
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
  errors.push(`${label}：${reason}`)
  return null
}

async function buildBundle(previous: InsightBundle | null): Promise<InsightBundle> {
  const errors: string[] = []
  const [taiexR, instR, derivR, marginR, lightR, exportR, cnbcR, baiR, ismR, sahmR, retailR] = await Promise.allSettled([
    fetchTaiexSeries(8),
    fetchInstitutions(),
    fetchDerivatives(),
    fetchMargin(),
    fetchLights(),
    fetchExports(),
    fetchCnbc(),
    fetchBai(),
    fetchIsm(),
    fetchSahm(),
    fetchRetail(),
  ])
  const taiex = settled(taiexR, errors, '加權指數') ?? []
  const institutions = settled(instR, errors, '三大法人')
  const derivatives = settled(derivR, errors, '期貨部位')
  const margin = settled(marginR, errors, '融資維持率')
  const retailFresh = settled(retailR, errors, '微台散戶多空比')
  const cnbc = settled(cnbcR, errors, 'CNBC')
  const prevCards = new Map<string, InsightMetric>()
  for (const card of previous?.cards ?? []) {
    prevCards.set(card.id, card)
    for (const item of card.items ?? []) prevCards.set(item.id, item)
  }
  // 抓不到就沿用上一次成功的值，避免頁面一格一格消失
  const keep = (fresh: InsightMetric | null, id: string, title: string, source: string, reason: unknown) => {
    if (fresh && fresh.status !== '暫缺') return fresh
    const old = prevCards.get(id)
    if (old && old.status !== '暫缺') return { ...old, note: '沿用上次資料' }
    return fresh ?? missing(id, title, source, reason)
  }
  const reasonOf = (result: PromiseSettledResult<unknown>) => (result.status === 'rejected' ? result.reason : '')
  const last = taiex[taiex.length - 1]
  const prevClose = last && last.change != null ? last.close - last.change : null
  const pct = last && last.change != null && prevClose ? (last.change / prevClose) * 100 : null
  const oldMarket = previous?.cards.find((card) => card.id === 'market')
  const market: InsightCard = last
    ? {
        ...metric({
          id: 'market',
          title: '前一日大盤',
          source: 'TWSE FMTQIK',
          value: fixed(last.close, 2),
          period: dayLabel(last.date),
          detail: `${signed(last.change, 2)} ${signed(pct, 2)}%`,
          detailTone: toneOf(last.change),
          status: (last.change ?? 0) > 0 ? '上漲' : (last.change ?? 0) < 0 ? '下跌' : '平盤',
          tone: toneOf(last.change),
        }),
        kind: 'market',
        asOf: last.date,
      }
    : oldMarket
      ? { ...oldMarket, note: '沿用上次資料' }
      : { ...missing('market', '前一日大盤', 'TWSE FMTQIK', reasonOf(taiexR)), kind: 'market' }
  market.institutions = institutions ?? oldMarket?.institutions
  market.derivatives = derivatives ?? oldMarket?.derivatives
  const items = [
    keep(settled(lightR, errors, '景氣燈號'), 'light', '景氣燈號', '國發會', reasonOf(lightR)),
    keep(settled(exportR, errors, '出口'), 'export', '台灣出口年增率', '關務署', reasonOf(exportR)),
    keep(cnbc?.bdi ?? null, 'bdi', 'BDI 乾散貨', 'CNBC', reasonOf(cnbcR)),
    keep(settled(baiR, errors, 'BAI'), 'bai', 'BAI 空運', 'TAC Index', reasonOf(baiR)),
    keep(settled(ismR, errors, 'ISM'), 'ism', '美國 ISM 製造業', 'Trading Economics', reasonOf(ismR)),
    keep(settled(sahmR, errors, '薩姆規則'), 'sahm', '薩姆規則', 'BLS 失業率', reasonOf(sahmR)),
    keep(cnbc?.brent ?? null, 'brent', '布蘭特原油', 'CNBC', reasonOf(cnbcR)),
    keep(cnbc?.gold ?? null, 'gold', '黃金', 'CNBC', reasonOf(cnbcR)),
  ]
  const bundleCard: InsightCard = { ...metric({ id: 'macro_bundle', title: '景氣／運價／原物料', source: '' }), kind: 'list', items }
  const overlay = margin ? overlayOf(margin.series, taiex) : previous?.overlay ?? []
  return {
    updatedAt: taipeiStamp(),
    cards: [market, bundleCard],
    margin: {
      latest: margin?.latest ?? previous?.margin.latest ?? null,
      label: MARGIN_LABEL,
      source: MARGIN_SOURCE,
      basis: margin ? MARGIN_BASIS : previous?.margin.basis,
      error: margin ? undefined : errors.find((line) => line.startsWith('融資維持率')),
    },
    overlay,
    retail: retailFresh
      ? { latest: retailFresh.points[retailFresh.points.length - 1]?.ratio ?? null, date: retailFresh.asOf, points: retailFresh.points, source: '期交所' }
      : previous?.retail ?? { latest: null, date: '', points: [], source: '期交所', error: errors.find((line) => line.startsWith('微台')) },
    errors,
  }
}

function zoneParts(timeZone: string, now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(now))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour').padStart(2, '0')
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hm: `${hour}:${get('minute').padStart(2, '0')}`,
    weekday: get('weekday'),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  }
}

function shiftDate(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10)
}

function weekdayOf(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
}

function previousBusinessDay(iso: string) {
  let day = shiftDate(iso, -1)
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) day = shiftDate(day, -1)
  return day
}

function latestClock(timeZone: string, afterHm: string, now: number) {
  const part = zoneParts(timeZone, now)
  if (part.weekday === 'Sat' || part.weekday === 'Sun' || part.hm < afterHm) return previousBusinessDay(part.date)
  return part.date
}

function addMonths(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** 每月固定日公布「上個月」的數字。公布日前，最新應有的是再上一期 */
function monthlyDataDue(releaseDay: number, releaseHm: string, now: number) {
  const part = zoneParts('Asia/Taipei', now)
  const released = part.day > releaseDay || (part.day === releaseDay && part.hm >= releaseHm)
  const release = released
    ? `${part.year}-${String(part.month).padStart(2, '0')}`
    : addMonths(part.year, part.month, -1)
  const [year, month] = release.split('-').map(Number)
  return addMonths(year, month, -1)
}

function firstWeekday(year: number, month: number, weekday: number) {
  let iso = `${year}-${String(month).padStart(2, '0')}-01`
  while (weekdayOf(iso) !== weekday) iso = shiftDate(iso, 1)
  return iso
}

function firstBusinessDay(year: number, month: number) {
  let iso = `${year}-${String(month).padStart(2, '0')}-01`
  while (weekdayOf(iso) === 0 || weekdayOf(iso) === 6) iso = shiftDate(iso, 1)
  return iso
}

function usMonthlyDue(releaseDay: (year: number, month: number) => string, releaseHm: string, now: number) {
  const part = zoneParts('America/New_York', now)
  const when = releaseDay(part.year, part.month)
  const released = part.date > when || (part.date === when && part.hm >= releaseHm)
  const release = released
    ? `${part.year}-${String(part.month).padStart(2, '0')}`
    : addMonths(part.year, part.month, -1)
  const [year, month] = release.split('-').map(Number)
  return addMonths(year, month, -1)
}

/** BAI 每週一 17:00 GMT 公布，台北時間是週二 01:00；代號用那個星期一 */
function baiDue(now: number) {
  const part = zoneParts('Asia/Taipei', now)
  let tuesday = part.date
  while (weekdayOf(tuesday) !== 2) tuesday = shiftDate(tuesday, -1)
  if (tuesday === part.date && part.hm < '01:10') tuesday = shiftDate(tuesday, -7)
  return shiftDate(tuesday, -1)
}

function monthDayKey(period: string, due: string) {
  const match = period.match(/(\d{1,2})月(\d{1,2})日/)
  if (!match || due.length < 10) return ''
  const year = Number(due.slice(0, 4))
  const month = match[1].padStart(2, '0')
  const day = match[2].padStart(2, '0')
  let iso = `${year}-${month}-${day}`
  if (iso > shiftDate(due, 7)) iso = `${year - 1}-${month}-${day}`
  return iso
}

function yearMonthKey(period: string) {
  const match = period.match(/(\d{4})年(\d{1,2})月/)
  if (!match) return ''
  return `${match[1]}-${match[2].padStart(2, '0')}`
}

function findItem(bundle: InsightBundle, id: string) {
  for (const card of bundle.cards) {
    if (card.id === id) return card
    const hit = card.items?.find((item) => item.id === id)
    if (hit) return hit
  }
  return undefined
}

function readDay(id: string) {
  return (bundle: InsightBundle, due: string) => {
    const item = findItem(bundle, id)
    if (item?.asOf && /^\d{4}-\d{2}-\d{2}/.test(item.asOf)) return item.asOf.slice(0, 10)
    return monthDayKey(item?.period ?? '', due)
  }
}

function readMonth(id: string) {
  return (bundle: InsightBundle) => {
    const item = findItem(bundle, id)
    if (item?.asOf && /^\d{4}-\d{2}$/.test(item.asOf)) return item.asOf
    return yearMonthKey(item?.period ?? '')
  }
}

function patchItem(bundle: InsightBundle, item: InsightMetric): InsightBundle {
  const cards = bundle.cards.map((card) => {
    if (card.kind !== 'list') return card
    const items = [...(card.items ?? [])]
    const index = items.findIndex((row) => row.id === item.id)
    if (index >= 0) items[index] = item
    else items.push(item)
    return { ...card, items }
  })
  return { ...bundle, updatedAt: taipeiStamp(), cards }
}

function withMarket(bundle: InsightBundle, patch: (card: InsightCard) => InsightCard): InsightBundle {
  let found = false
  const cards = bundle.cards.map((card) => {
    if (card.id !== 'market') return card
    found = true
    return patch(card)
  })
  if (!found) {
    cards.unshift(
      patch({ ...metric({ id: 'market', title: '前一日大盤', source: 'TWSE FMTQIK' }), kind: 'market' }),
    )
  }
  return { ...bundle, updatedAt: taipeiStamp(), cards }
}

function emptyBundle(): InsightBundle {
  return {
    updatedAt: '',
    cards: [
      { ...metric({ id: 'market', title: '前一日大盤', source: 'TWSE FMTQIK' }), kind: 'market' },
      { ...metric({ id: 'macro_bundle', title: '景氣／運價／原物料', source: '' }), kind: 'list', items: [] },
    ],
    margin: { latest: null, label: MARGIN_LABEL, source: MARGIN_SOURCE },
    overlay: [],
    retail: { latest: null, date: '', points: [], source: '期交所' },
    errors: [],
    releases: {},
  }
}

type Fresh = { asOf: string; apply: (bundle: InsightBundle) => InsightBundle }
type Job = {
  id: string
  retryMs: number
  tries: number
  due: (now: number) => string
  read: (bundle: InsightBundle, due: string) => string
  pull: () => Promise<Fresh>
}

const HALF_HOUR = 30 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

function itemJob(
  id: string,
  due: (now: number) => string,
  read: (bundle: InsightBundle, due: string) => string,
  pull: () => Promise<InsightMetric>,
  retryMs: number,
  tries: number,
): Job {
  return {
    id,
    due,
    read,
    retryMs,
    tries,
    pull: async () => {
      const item = await pull()
      return { asOf: item.asOf ?? '', apply: (bundle) => patchItem(bundle, item) }
    },
  }
}

// 時間都是該市場公布後再等約 10 分鐘。抓到的日期還沒換新，就依 retry 再試，不會每分鐘打。
const JOBS: Job[] = [
  {
    id: 'market',
    retryMs: HALF_HOUR,
    tries: 4,
    due: (now) => latestClock('Asia/Taipei', '15:10', now),
    read: (bundle) => marketAsOf(bundle),
    pull: async () => {
      const taiex = await fetchTaiexSeries()
      const last = taiex[taiex.length - 1]
      if (!last) throw new Error('沒有加權指數')
      const prevClose = last.change != null ? last.close - last.change : null
      const pct = last.change != null && prevClose ? (last.change / prevClose) * 100 : null
      const next = {
        ...metric({
          id: 'market',
          title: '前一日大盤',
          source: 'TWSE FMTQIK',
          value: fixed(last.close, 2),
          period: dayLabel(last.date),
          detail: `${signed(last.change, 2)} ${signed(pct, 2)}%`,
          detailTone: toneOf(last.change),
          status: (last.change ?? 0) > 0 ? '上漲' : (last.change ?? 0) < 0 ? '下跌' : '平盤',
          tone: toneOf(last.change),
        }),
        kind: 'market' as const,
        asOf: last.date,
      }
      return {
        asOf: last.date,
        apply: (bundle) => withMarket(bundle, (old) => ({ ...old, ...next, institutions: old.institutions, derivatives: old.derivatives })),
      }
    },
  },
  {
    id: 'institutions',
    retryMs: HALF_HOUR,
    tries: 4,
    due: (now) => latestClock('Asia/Taipei', '16:00', now),
    read: (bundle, due) => {
      const card = bundle.cards.find((row) => row.id === 'market')
      if (card?.institutions?.date) return card.institutions.date
      if (card?.institutions?.dateLabel && card.institutions.dateLabel === dayLabel(due)) return due
      return ''
    },
    pull: async () => {
      const data = await fetchInstitutions()
      if (!data.date) throw new Error('三大法人沒有日期')
      return { asOf: data.date, apply: (bundle) => withMarket(bundle, (old) => ({ ...old, institutions: data })) }
    },
  },
  {
    id: 'derivatives',
    retryMs: HALF_HOUR,
    tries: 4,
    due: (now) => latestClock('Asia/Taipei', '16:00', now),
    read: (bundle, due) => {
      const card = bundle.cards.find((row) => row.id === 'market')
      if (card?.derivatives?.date) return card.derivatives.date
      if (card?.derivatives?.dateLabel && card.derivatives.dateLabel === dayLabel(due)) return due
      return ''
    },
    pull: async () => {
      const data = await fetchDerivatives()
      if (!data.date) throw new Error('期貨部位沒有日期')
      return { asOf: data.date, apply: (bundle) => withMarket(bundle, (old) => ({ ...old, derivatives: data })) }
    },
  },
  {
    id: 'margin',
    retryMs: HALF_HOUR,
    tries: 4,
    due: (now) => latestClock('Asia/Taipei', '21:30', now),
    read: (bundle, due) => {
      if (bundle.margin.basis !== MARGIN_BASIS || bundle.overlay.length < 100) return ''
      const date = bundle.margin.latest?.date ?? ''
      if (!date || !bundle.overlay.some((row) => row.balance != null)) return ''
      return date >= due ? date : ''
    },
    pull: async () => {
      const [margin, taiex] = await Promise.all([fetchMargin(), fetchTaiexSeries(8)])
      const asOf = margin.latest?.date ?? ''
      if (!asOf) throw new Error('融資維持率沒有日期')
      return {
        asOf,
        apply: (bundle) => ({
          ...bundle,
          updatedAt: taipeiStamp(),
          margin: { latest: margin.latest, label: MARGIN_LABEL, source: MARGIN_SOURCE, basis: MARGIN_BASIS },
          overlay: overlayOf(margin.series, taiex),
          errors: bundle.errors.filter((line) => !line.startsWith('融資維持率')),
        }),
      }
    },
  },
  itemJob('bdi', (now) => latestClock('Europe/London', '13:05', now), readDay('bdi'), async () => (await fetchCnbc()).bdi, HALF_HOUR, 4),
  itemJob('gold', (now) => latestClock('Europe/London', '15:05', now), readDay('gold'), async () => (await fetchCnbc()).gold, HALF_HOUR, 4),
  itemJob('brent', (now) => latestClock('Europe/London', '19:35', now), readDay('brent'), async () => (await fetchCnbc()).brent, HALF_HOUR, 4),
  itemJob('bai', baiDue, readDay('bai'), fetchBai, 6 * 60 * 60 * 1000, 4),
  itemJob('ism', (now) => usMonthlyDue(firstBusinessDay, '10:10', now), readMonth('ism'), fetchIsm, DAY, 6),
  itemJob('sahm', (now) => usMonthlyDue((year, month) => firstWeekday(year, month, 5), '08:40', now), readMonth('sahm'), fetchSahm, DAY, 6),
  itemJob('light', (now) => monthlyDataDue(27, '16:10', now), readMonth('light'), fetchLights, DAY, 8),
  itemJob('export', (now) => monthlyDataDue(8, '16:10', now), readMonth('export'), fetchExports, DAY, 8),
  {
    id: 'retail',
    retryMs: HALF_HOUR,
    tries: 8,
    due: (now) => latestClock('Asia/Taipei', '16:30', now),
    read: (bundle, due) => (bundle.retail?.date && bundle.retail.date >= due ? bundle.retail.date : ''),
    pull: async () => {
      const fresh = await fetchRetail()
      const latest = fresh.points[fresh.points.length - 1]?.ratio ?? null
      return {
        asOf: fresh.asOf,
        apply: (bundle) => ({
          ...bundle,
          updatedAt: taipeiStamp(),
          retail: { latest, date: fresh.asOf, points: fresh.points, source: '期交所' },
          errors: bundle.errors.filter((line) => !line.startsWith('微台')),
        }),
      }
    },
  },
]

let bundleMemory: InsightBundle | null = null
let sweeping = false
const attempts = new Map<string, { key: string; n: number; next: number }>()

async function loadBundle() {
  if (!bundleMemory) bundleMemory = (await readJson<InsightBundle>(bundleFile)) ?? emptyBundle()
  if (!bundleMemory.releases) bundleMemory.releases = {}
  return bundleMemory
}

async function saveBundle(bundle: InsightBundle) {
  bundleMemory = bundle
  await writeJson(bundleFile, bundle)
}

function remember(bundle: InsightBundle, now = Date.now()) {
  const releases = { ...bundle.releases }
  for (const job of JOBS) {
    const due = job.due(now)
    const held = due ? job.read(bundle, due) : ''
    if (due && held && held >= due) releases[job.id] = due
  }
  return { ...bundle, releases }
}

async function sweep() {
  if (sweeping) return
  sweeping = true
  try {
    let bundle = await loadBundle()
    const now = Date.now()
    let dirty = false
    const releases = { ...bundle.releases }
    for (const job of JOBS) {
      const due = job.due(now)
      if (!due) continue
      const held = job.read(bundle, due)
      if (held && held >= due) {
        if (releases[job.id] !== due) {
          releases[job.id] = due
          dirty = true
        }
        continue
      }
      const state = attempts.get(job.id)
      if (state?.key === due && (now < state.next || state.n >= job.tries)) continue
      try {
        const fresh = await job.pull()
        if (fresh.asOf && (!held || fresh.asOf > held)) {
          bundle = fresh.apply({ ...bundle, releases })
          bundle = { ...bundle, releases, updatedAt: taipeiStamp() }
          dirty = true
        }
        if (fresh.asOf && fresh.asOf >= due) {
          releases[job.id] = due
          bundle = { ...bundle, releases }
          attempts.delete(job.id)
          dirty = true
        } else {
          const n = (state?.key === due ? state.n : 0) + 1
          attempts.set(job.id, { key: due, n, next: now + job.retryMs })
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.error(`[insight] ${job.id} ${reason}`)
        const n = (state?.key === due ? state.n : 0) + 1
        attempts.set(job.id, { key: due, n, next: now + job.retryMs })
      }
    }
    if (dirty) await saveBundle({ ...bundle, releases })
  } finally {
    sweeping = false
  }
}

export async function getInsightBundle(force: boolean) {
  if (!force) return { bundle: await loadBundle(), fromCache: true }
  while (sweeping) await new Promise((resolve) => setTimeout(resolve, 200))
  sweeping = true
  try {
    const next = remember(await buildBundle(await loadBundle()))
    await saveBundle(next)
    return { bundle: next, fromCache: false }
  } finally {
    sweeping = false
  }
}

/** 每分鐘只看時鐘。某一項的公布時間到了、而且手上還是舊的，才去抓那一項 */
export function startInsightRefresh() {
  void sweep()
  const timer = setInterval(() => void sweep(), 60_000)
  timer.unref?.()
}

/** 報告裡引用的大盤日期（從 markdown 第一行「前一日大盤」解析） */
function reportMarketIso(report: InsightReport | null) {
  const line = report?.markdown?.split('\n').find((row) => row.includes('前一日大盤')) ?? ''
  const match = line.match(/（(\d{1,2})月(\d{1,2})日）/)
  if (!match) return ''
  return periodToIso(`${match[1]}月${match[2]}日`, taipeiParts().date)
}

/** 大盤日期比報告新時，用規則引擎重寫報告（不必等人按按鈕）；有金鑰也不在背景呼叫 Grok */
export async function maybeRefreshInsightReport(rows: InsightQuote[] = []) {
  const { bundle } = await getInsightBundle(false)
  const asOf = marketAsOf(bundle)
  if (!asOf) return null
  const previous = await readInsightReport()
  if (previous && reportMarketIso(previous) >= asOf) return previous
  const report = rulesReport(bundle, rows, previous?.note?.includes('Grok') ? previous.note : '收盤資料更新後自動重算（規則引擎）。')
  await writeJson(reportFile, report)
  return report
}

export async function readInsightReport() {
  return readJson<InsightReport>(reportFile)
}

function brief(item: InsightMetric | undefined) {
  if (!item) return ''
  const parts = [`${item.title}：${item.value}`]
  if (item.period) parts.push(`（${item.period}）`)
  if (item.detail && item.detail !== '—') parts.push(` ${item.detail}`)
  if (item.status) parts.push(` ${item.status}`)
  return parts.join('')
}

function ideaOf(row: InsightQuote): InsightIdea {
  const { quote, force } = row
  const change = quote.pct
  let action: string
  let reason: string
  if (change == null) {
    action = '觀望'
    reason = '缺報價，先不操作。'
  } else if (change <= -3) {
    action = '觀察反彈／分批'
    reason = `單日跌幅 ${change.toFixed(2)}% 偏大，若基本面無惡化可等止穩後再考慮。`
  } else if (change >= 3) {
    action = '勿追高／留意獲利了結'
    reason = `單日漲幅 ${change.toFixed(2)}% 偏強，追價風險升高，宜看量價能否延續。`
  } else if (change >= 0) {
    action = '持有／逢回加碼觀察'
    reason = `漲跌幅 ${change.toFixed(2)}% 相對穩健，可搭配大盤與產業節奏操作。`
  } else {
    action = '觀望／設停損'
    reason = `小幅偏弱（${change.toFixed(2)}%），先看是否跌破關鍵支撐。`
  }
  if (force != null) {
    const share = quote.volume ? Math.abs(force) / quote.volume : 0
    reason += ` 台新逐筆買賣力 ${signed(force, 0)} 張`
    if (share >= 0.1 && change != null) {
      if (force > 0 && change < 0) reason += '，價弱但外盤承接多，可留意止穩。'
      else if (force < 0 && change > 0) reason += '，價漲但內盤賣壓較重，追價要保守。'
      else reason += force > 0 ? '，外盤主動買進為主。' : '，內盤主動賣出為主。'
    } else {
      reason += '，買賣力接近平衡。'
    }
  }
  return {
    code: quote.symbol,
    name: quote.name,
    action,
    reason,
    changePercent: change,
    price: quote.price,
    force,
    source: row.taishin ? 'taishin' : 'twse',
  }
}

function rulesReport(bundle: InsightBundle, rows: InsightQuote[], note?: string): InsightReport {
  const market = bundle.cards.find((card) => card.id === 'market')
  const list = new Map((bundle.cards.find((card) => card.id === 'macro_bundle')?.items ?? []).map((item) => [item.id, item]))
  const keep = bundle.margin.latest?.keepRate ?? null
  const overlay = bundle.overlay
  const keepDelta = overlay.length >= 2 ? overlay[overlay.length - 1].keepRate - overlay[overlay.length - 2].keepRate : null
  const risk: string[] = []
  if (keep == null) risk.push('融資維持率暫缺。')
  else if (keep < 150) risk.push(`大盤融資維持率 ${keep.toFixed(2)}% 偏低，追繳／處分壓力需提高警戒。`)
  else if (keep < 170) risk.push(`大盤融資維持率 ${keep.toFixed(2)}% 位於中性偏緊區間。`)
  else risk.push(`大盤融資維持率 ${keep.toFixed(2)}%，信用風險相對可控。`)
  if (keepDelta != null) risk.push(`較前一交易日${keepDelta < 0 ? '下降' : '上升'} ${Math.abs(keepDelta).toFixed(2)} 個百分點。`)
  const tone = market?.tone ?? 'flat'
  const [stance, stanceNote] =
    tone === 'down'
      ? ['偏防守', '大盤收斂或下跌時，優先降低槓桿與追高節奏，改以分批布局優質標的。']
      : tone === 'up'
        ? ['偏積極但控風險', '大盤偏多時可留意強勢股延續，但仍應用維持率與出口／ISM 確認風險承受度。']
        : ['中性觀察', '方向不明時以既有持股汰弱留強為主，避免一次性大倉位。']
  const stockIdeas = rows.map(ideaOf)
  const holdings: InsightHolding[] = []
  if (tone !== 'down') holdings.push({ bucket: '核心', idea: '電子權值／高股息防禦', note: '作為台股主軸配置，波動時優先保留。' })
  holdings.push({ bucket: '衛星', idea: '報價列表中相對強勢且量能配合者', note: '只做確認過的強勢股，嚴設停損。' })
  if (keep != null && keep < 160) holdings.push({ bucket: '現金', idea: '提高現金比重', note: '維持率偏低時保留彈藥，等待波動收斂。' })
  const parties = market?.institutions?.items.map((item) => `${item.name} ${item.text}`).join('、')
  const lines = [
    '# 台股日報操作建議（規則引擎）',
    '',
    `- 產生時間：${taipeiStamp()}`,
    `- 總體立場：**${stance}**`,
    `- ${stanceNote}`,
    '',
    '## 市場總覽',
    `- ${brief(market)}`,
    parties ? `- 三大法人：${parties}` : '',
    ...['light', 'export', 'bdi', 'bai', 'ism', 'sahm', 'brent', 'gold'].map((id) => `- ${brief(list.get(id))}`),
    '',
    '## 融資維持率與風險',
    ...risk.map((line) => `- ${line}`),
    '',
    '## 報價列表個股建議',
    ...(stockIdeas.length
      ? stockIdeas.map((idea) => `- **${idea.code} ${idea.name}**：${idea.action}。${idea.reason}`)
      : ['- 報價列表是空的。']),
    '',
    '## 建議持股架構',
    ...holdings.map((item) => `- **${item.bucket}**：${item.idea}（${item.note}）`),
    '',
    '以上是研究筆記，不是投資建議，下單前請自行確認。',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '')
  return {
    generatedAt: new Date().toISOString(),
    engine: 'rules',
    symbols: rows.map((row) => row.quote.symbol),
    stance,
    marketSummary: stanceNote,
    stockIdeas,
    holdings,
    markdown: lines.join('\n'),
    note,
  }
}

const MODEL = 'grok-4.7'

async function grokReport(bundle: InsightBundle, rows: InsightQuote[], key: string): Promise<InsightReport> {
  const base = rulesReport(bundle, rows)
  const payload = {
    updatedAt: bundle.updatedAt,
    market: bundle.cards.find((card) => card.id === 'market'),
    macro: bundle.cards.find((card) => card.id === 'macro_bundle')?.items?.map((item) => brief(item)),
    margin: bundle.margin.latest,
    keepRateRecent: bundle.overlay.slice(-10),
    quotes: rows.map((row) => ({
      code: row.quote.symbol,
      name: row.quote.name,
      price: row.quote.price,
      changePercent: row.quote.pct,
      volumeLots: row.quote.volume,
      taishinForceLots: row.force,
      source: row.taishin ? '台新即時' : '證交所',
    })),
  }
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是台灣股票的專業投資經理。只用使用者提供的數字，不要編造沒有的數據。用繁體中文，輸出 JSON，不要其他文字。格式：{"stance":"","marketSummary":"","stockIdeas":[{"code":"","name":"","action":"","reason":""}],"holdings":[{"bucket":"核心|衛星|現金","idea":"","note":""}],"markdown":""}。stockIdeas 涵蓋 quotes 每一檔，taishinForceLots 是台新逐筆外盤減內盤的累積張數，可用來判斷買賣力。markdown 用 # / ## / - 寫完整日報，含市場總覽、融資維持率與風險、個股建議、持股架構。',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ...base, note: `Grok 沒有完成（${res.status}），已改用規則引擎。${text.slice(0, 120)}` }
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const matched = (json.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/)
  if (!matched) return { ...base, note: 'Grok 沒有回傳報告，已改用規則引擎。' }
  let parsed: Partial<InsightReport> & { stockIdeas?: Partial<InsightIdea>[] }
  try {
    parsed = JSON.parse(matched[0])
  } catch {
    return { ...base, note: 'Grok 回傳格式不對，已改用規則引擎。' }
  }
  const byCode = new Map(base.stockIdeas.map((idea) => [idea.code, idea]))
  const ideas = (parsed.stockIdeas ?? []).flatMap((idea) => {
    const known = byCode.get(String(idea.code ?? ''))
    if (!known) return []
    return [{ ...known, action: idea.action || known.action, reason: idea.reason || known.reason }]
  })
  for (const idea of base.stockIdeas) if (!ideas.some((row) => row.code === idea.code)) ideas.push(idea)
  return {
    generatedAt: new Date().toISOString(),
    engine: 'grok',
    model: MODEL,
    symbols: base.symbols,
    stance: parsed.stance || base.stance,
    marketSummary: parsed.marketSummary || base.marketSummary,
    stockIdeas: ideas,
    holdings: parsed.holdings?.length ? parsed.holdings : base.holdings,
    markdown: parsed.markdown || base.markdown,
  }
}

export async function makeInsightReport(rows: InsightQuote[], key: string) {
  const { bundle } = await getInsightBundle(false)
  let report: InsightReport
  if (!key) {
    report = rulesReport(bundle, rows, '尚未設定 Grok API 金鑰（data/xai-key.txt），先用規則引擎。')
  } else {
    try {
      report = await grokReport(bundle, rows, key)
    } catch (reason) {
      report = rulesReport(bundle, rows, `Grok 連線失敗，已改用規則引擎。${reason instanceof Error ? reason.message : ''}`)
    }
  }
  await writeJson(reportFile, report)
  return report
}
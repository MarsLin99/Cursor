export type QuoteRow = {
  symbol: string
  name: string
  market: 'twse' | 'tpex'
  price: number | null
  change: number | null
  pct: number | null
  bid: number | null
  ask: number | null
  volume: number | null
  open: number | null
  high: number | null
  low: number | null
  prev: number | null
  time: string
}

export type SectorMove = {
  name: string
  pct: number
  points: number
  /** 成交金額佔大盤比重，MoneyDJ 流向率 */
  flow: number | null
}

export type IndexPoint = { time: string; value: number }

export type MacroSnapshot = {
  scannedAt: string | null
  /** 類股流向最後刷新時間（ISO）、MIS 類股指數時間（HH:MM:SS）、MoneyDJ 流向表更新時間 */
  sectorsAt?: string | null
  sectorsTime?: string
  flowUpdated?: string
  scanning: boolean
  index: {
    price: number | null
    change: number | null
    pct: number | null
    date: string
    time: string
  }
  institutions: {
    foreign: number | null
    trust: number | null
    dealer: number | null
  }
  sectors: SectorMove[]
  gold: { price: number | null; change: number | null; pct: number | null } | null
  brent: { price: number | null; change: number | null; pct: number | null } | null
  indexHistory: IndexPoint[]
  news: { title: string; time: string }[]
  /** 官方沒有穩定介面的項目維持空白，不填假數字 */
  blanks: string[]
}

export type TickerItem = {
  tag: string
  kind: 'flash' | 'major' | 'trump' | 'stock'
  time: string
  title: string
  url: string
  at: number
  symbol?: string
}

export type WinPick = {
  symbol: string
  name: string
  winRate: number
  samples: number
}

export type ReportStock = {
  symbol: string
  name: string
  action: string
  detail: string
}

export type DeskReport = {
  generatedAt: string
  engine: 'grok' | 'rules'
  stance: string
  summary: string
  stocks: ReportStock[]
  satellite: ReportStock[]
  highWin: WinPick[]
  marketBullets: string[]
  structure: string[]
  note?: string
}

export type IntradayBar = {
  time: string
  close: number
  volume: number
  up: boolean
}

export type SparkPoint = { t: string; p: number }
export type SparkForce = { t: string; d: number }
/** 每分鐘外盤／內盤張數。taishin＝台新逐筆，est＝依一分K收盤位置估計 */
export type SparkFlow = { t: string; out: number; inn: number; src: 'taishin' | 'est' }

/** 台新行情累積的當日走勢。漲跌停與開盤在盤中固定。 */
export type SparkBook = {
  symbol: string
  name: string
  limitUp: number | null
  limitDown: number | null
  open: number | null
  price: number | null
  prev: number | null
  bid: number | null
  ask: number | null
  high: number | null
  low: number | null
  volume: number | null
  time: string
  bias: number
  points: SparkPoint[]
  force: SparkForce[]
  /** 買賣力道資料的日期（YYYY-MM-DD），開盤前可能是前一交易日 */
  forceDate?: string
  /** 每分鐘買賣力（force 為其累積） */
  flow?: SparkFlow[]
  /** 資料來源統計：台新點數、補點數、台新／估計分鐘數 */
  sources?: {
    taishinPoints: number
    filledPoints: number
    taishinMinutes: number
    estMinutes: number
    cnyesBars: number
    yahooBars: number
  }
}

/** 分析頁（OneWebStock 版型）：燈號色、漲跌色 */
export type InsightTone = 'up' | 'down' | 'flat' | 'alert' | 'red' | 'yellow-red' | 'green' | 'yellow-blue' | 'blue'

export type InsightMetric = {
  id: string
  title: string
  value: string
  period: string
  detail: string
  detailTone: InsightTone
  status: string
  tone: InsightTone
  note: string
  source: string
  /** 景氣燈號用圓點，其餘用膠囊 */
  lamp?: boolean
}

export type InsightParty = { name: string; text: string; tone: InsightTone }
export type InsightBar = { label: string; value: number; level: number; tone: InsightTone }

export type InsightCard = InsightMetric & {
  kind: 'market' | 'list'
  items?: InsightMetric[]
  institutions?: { dateLabel: string; items: InsightParty[] }
  derivatives?: { dateLabel: string; title: string; unit: string; bars: InsightBar[] }
}

export type MarginSnapshot = {
  date: string
  keepRate: number | null
  callAccNum: number | null
  exeAccNum: number | null
  belowAccNum: number | null
  marginAccRate: number | null
}

export type OverlayPoint = { date: string; keepRate: number; taiex: number | null }

export type InsightBundle = {
  updatedAt: string
  cards: InsightCard[]
  margin: { latest: MarginSnapshot | null; label: string; source: string; error?: string }
  overlay: OverlayPoint[]
  errors: string[]
}

export type InsightIdea = {
  code: string
  name: string
  action: string
  reason: string
  changePercent: number | null
  price: number | null
  /** 台新逐筆累積買賣力（外盤−內盤張數），沒有台新資料時為 null */
  force: number | null
  source: 'taishin' | 'twse'
}

export type InsightHolding = { bucket: string; idea: string; note: string }

export type InsightReport = {
  generatedAt: string
  engine: 'grok' | 'rules'
  model?: string
  stance: string
  marketSummary: string
  stockIdeas: InsightIdea[]
  holdings: InsightHolding[]
  markdown: string
  note?: string
}
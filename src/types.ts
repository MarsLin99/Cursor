export type Candle = {
  time: string // YYYY-MM-DD
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type StockSeries = {
  symbol: string
  name: string
  source: 'twse' | 'yahoo' | 'demo'
  candles: Candle[]
}

export type IndicatorKey =
  | 'ma5'
  | 'ma20'
  | 'ma60'
  | 'ema12'
  | 'ema26'
  | 'bb'
  | 'rsi'
  | 'macd'
  | 'kd'

export type IndicatorSettings = Record<IndicatorKey, boolean>

export type TradeSide = 'buy' | 'sell' | 'short' | 'cover'

export type Trade = {
  id: string
  side: TradeSide
  price: number
  qty: number
  candleIndex: number
  time: string
}

export type ClosedRound = {
  id: string
  kind: 'spot' | 'option'
  /** 該筆了結的方向 */
  direction: 'long' | 'short'
  qty: number
  entryPrice: number
  exitPrice: number
  pnl: number
  openTime: string
  closeTime: string
  label: string
}

export type PositionState = {
  /** 正數＝做多持股；負數＝放空股數 */
  qty: number
  avgCost: number
  cash: number
  realizedPnl: number
  trades: Trade[]
  closedRounds: ClosedRound[]
}

export type HedgeChoice =
  | 'buy_put'
  | 'collar'
  | 'sell_call'
  | 'do_nothing'
  | 'add_long'

export type OptionKind = 'put' | 'call'
export type OptionSide = 'long' | 'short'

export type OptionPosition = {
  id: string
  eventId: string
  eventTitle: string
  kind: OptionKind
  side: OptionSide
  contracts: number
  strike: number
  entryPremium: number
  openSpot: number
  openIndex: number
  openTime: string
  closed: boolean
  closePremium?: number
  closeIndex?: number
  closeTime?: string
  realizedPnl?: number
}

export type MarketEvent = {
  id: string
  title: string
  narrative: string
  severity: 'mild' | 'sharp' | 'crash' | 'rally' | 'volatile'
  /** expected directional bias after event for scoring context */
  bias: 'down' | 'up' | 'volatile'
  choices: {
    id: HedgeChoice
    label: string
    hint: string
  }[]
}

export type EventOccurrence = {
  event: MarketEvent
  triggerIndex: number
  choice: HedgeChoice | null
  contracts: number | null
  optionIds: string[]
  resultPnl: number | null
  resolved: boolean
}

export type ReplaySpeed = 1 | 2 | 4 | 8

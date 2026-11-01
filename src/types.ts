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

export type TradeSide = 'buy' | 'sell'

export type Trade = {
  id: string
  side: TradeSide
  price: number
  qty: number
  candleIndex: number
  time: string
}

export type PositionState = {
  qty: number
  avgCost: number
  cash: number
  realizedPnl: number
  trades: Trade[]
}

export type HedgeChoice =
  | 'buy_put'
  | 'collar'
  | 'sell_call'
  | 'do_nothing'
  | 'add_long'

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
  resolveIndex: number
  choice: HedgeChoice | null
  resultPnl: number | null
  resolved: boolean
}

export type ReplaySpeed = 1 | 2 | 4 | 8

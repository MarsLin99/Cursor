import type {
  ClosedRound,
  HedgeChoice,
  MarketEvent,
  OptionPosition,
} from '../types'

/** 台股個股選擇權：1 口 ≈ 1,000 股 */
export const OPTION_LOT = 1000

export function estimatePremiums(
  spot: number,
  severity: MarketEvent['severity'],
): { put: number; call: number } {
  const putPct =
    severity === 'crash'
      ? 0.022
      : severity === 'sharp'
        ? 0.018
        : severity === 'volatile'
          ? 0.02
          : 0.014
  const callPct =
    severity === 'volatile' || severity === 'rally' ? 0.016 : 0.012
  return {
    put: Number((spot * putPct).toFixed(2)),
    call: Number((spot * callPct).toFixed(2)),
  }
}

export function strategyNeedsContracts(choice: HedgeChoice): boolean {
  return choice === 'buy_put' || choice === 'collar' || choice === 'sell_call'
}

export function strategyCashPreview(
  choice: HedgeChoice,
  spot: number,
  severity: MarketEvent['severity'],
  contracts: number,
): { label: string; cashDelta: number } {
  const { put, call } = estimatePremiums(spot, severity)
  const n = Math.max(1, contracts) * OPTION_LOT
  switch (choice) {
    case 'buy_put':
      return { label: '預估付出權利金', cashDelta: -(put * n) }
    case 'sell_call':
      return { label: '預估收進權利金', cashDelta: call * n }
    case 'collar':
      return { label: '預估淨權利金', cashDelta: -(put * n) + call * n }
    case 'add_long':
      return { label: '加碼現貨成本', cashDelta: -(spot * contracts * OPTION_LOT) }
    default:
      return { label: '無現金變動', cashDelta: 0 }
  }
}

export function markOptionPremium(
  pos: OptionPosition,
  spot: number,
  barsHeld: number,
): number {
  const entryIntrinsic =
    pos.kind === 'put'
      ? Math.max(0, pos.strike - pos.openSpot)
      : Math.max(0, pos.openSpot - pos.strike)
  const extrinsic0 = Math.max(0.05, pos.entryPremium - entryIntrinsic)
  const decay = Math.max(0.12, 1 - barsHeld / 45)
  const intrinsic =
    pos.kind === 'put'
      ? Math.max(0, pos.strike - spot)
      : Math.max(0, spot - pos.strike)
  return Number((intrinsic + extrinsic0 * decay).toFixed(2))
}

export function optionUnrealized(
  pos: OptionPosition,
  markPremium: number,
): number {
  const perShare =
    pos.side === 'long'
      ? markPremium - pos.entryPremium
      : pos.entryPremium - markPremium
  return perShare * OPTION_LOT * pos.contracts
}

export function optionOpenCashDelta(pos: OptionPosition): number {
  const premium = pos.entryPremium * OPTION_LOT * pos.contracts
  return pos.side === 'long' ? -premium : premium
}

export function optionCloseCashDelta(
  pos: OptionPosition,
  markPremium: number,
): number {
  const premium = markPremium * OPTION_LOT * pos.contracts
  // 平倉：多單賣出收錢，空單買回付錢
  return pos.side === 'long' ? premium : -premium
}

export function buildOptionLegs(params: {
  eventId: string
  eventTitle: string
  choice: HedgeChoice
  contracts: number
  spot: number
  severity: MarketEvent['severity']
  candleIndex: number
  time: string
}): OptionPosition[] {
  const { choice, contracts, spot, severity, eventId, eventTitle, candleIndex, time } =
    params
  if (!strategyNeedsContracts(choice) || contracts <= 0) return []

  const { put, call } = estimatePremiums(spot, severity)
  const stamp = Math.random().toString(36).slice(2, 7)
  const base = {
    eventId,
    eventTitle,
    contracts,
    openSpot: spot,
    openIndex: candleIndex,
    openTime: time,
    closed: false as const,
  }

  if (choice === 'buy_put') {
    return [
      {
        ...base,
        id: `${eventId}-put-${stamp}`,
        kind: 'put',
        side: 'long',
        strike: spot,
        entryPremium: put,
      },
    ]
  }
  if (choice === 'sell_call') {
    return [
      {
        ...base,
        id: `${eventId}-call-${stamp}`,
        kind: 'call',
        side: 'short',
        strike: spot,
        entryPremium: call,
      },
    ]
  }
  if (choice === 'collar') {
    return [
      {
        ...base,
        id: `${eventId}-put-${stamp}`,
        kind: 'put',
        side: 'long',
        strike: spot,
        entryPremium: put,
      },
      {
        ...base,
        id: `${eventId}-call-${stamp}`,
        kind: 'call',
        side: 'short',
        strike: Number((spot * 1.03).toFixed(2)),
        entryPremium: call,
      },
    ]
  }
  return []
}

export function describeLeg(pos: OptionPosition): string {
  const side = pos.side === 'long' ? '買' : '賣'
  const kind = pos.kind === 'put' ? 'Put' : 'Call'
  return `${side}${kind} ${pos.contracts} 口`
}

export function optionToClosedRound(
  pos: OptionPosition,
  closePremium: number,
  closeTime: string,
  realizedPnl: number,
): ClosedRound {
  return {
    id: `opt-${pos.id}-${closeTime}`,
    kind: 'option',
    direction: pos.side,
    qty: pos.contracts * OPTION_LOT,
    entryPrice: pos.entryPremium,
    exitPrice: closePremium,
    pnl: realizedPnl,
    openTime: pos.openTime,
    closeTime,
    label: `${pos.eventTitle}｜${describeLeg(pos)}`,
  }
}

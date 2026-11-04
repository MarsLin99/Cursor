import { useCallback, useMemo, useRef, useState } from 'react'
import type { ClosedRound, PositionState, Trade, TradeSide } from '../types'

const INITIAL_CASH = 4_000_000

type Lot = { qty: number; price: number; time: string }

function createInitial(): PositionState {
  return {
    qty: 0,
    avgCost: 0,
    cash: INITIAL_CASH,
    realizedPnl: 0,
    trades: [],
    closedRounds: [],
  }
}

function makeTrade(
  side: TradeSide,
  price: number,
  qty: number,
  candleIndex: number,
  time: string,
): Trade {
  const tag = side[0].toUpperCase()
  return {
    id: `${time}-${tag}-${qty}-${Math.random().toString(36).slice(2, 7)}`,
    side,
    price,
    qty,
    candleIndex,
    time,
  }
}

function makeRound(params: {
  direction: 'long' | 'short'
  qty: number
  entryPrice: number
  exitPrice: number
  pnl: number
  openTime: string
  closeTime: string
}): ClosedRound {
  return {
    id: `spot-${params.closeTime}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'spot',
    direction: params.direction,
    qty: params.qty,
    entryPrice: params.entryPrice,
    exitPrice: params.exitPrice,
    pnl: params.pnl,
    openTime: params.openTime,
    closeTime: params.closeTime,
    label: params.direction === 'long' ? '現貨做多' : '現貨放空',
  }
}

/** FIFO 了結部位，回傳加權成本、開倉時間與產生的 round */
function closeLotsFifo(
  lots: Lot[],
  qtyToClose: number,
  exitPrice: number,
  closeTime: string,
  direction: 'long' | 'short',
): { rounds: ClosedRound[]; remaining: Lot[]; realized: number } {
  let left = qtyToClose
  let realized = 0
  const rounds: ClosedRound[] = []
  const remaining = [...lots]

  while (left > 0 && remaining.length) {
    const lot = remaining[0]
    const take = Math.min(left, lot.qty)
    const pnl =
      direction === 'long'
        ? (exitPrice - lot.price) * take
        : (lot.price - exitPrice) * take
    realized += pnl
    rounds.push(
      makeRound({
        direction,
        qty: take,
        entryPrice: lot.price,
        exitPrice,
        pnl,
        openTime: lot.time,
        closeTime,
      }),
    )
    if (take >= lot.qty) remaining.shift()
    else remaining[0] = { ...lot, qty: lot.qty - take }
    left -= take
  }

  return { rounds, remaining, realized }
}

function avgFromLots(lots: Lot[]): number {
  const qty = lots.reduce((s, l) => s + l.qty, 0)
  if (!qty) return 0
  return lots.reduce((s, l) => s + l.price * l.qty, 0) / qty
}

export function usePaperTrade() {
  const [state, setState] = useState<PositionState>(createInitial)
  const stateRef = useRef(state)
  stateRef.current = state
  const lotsRef = useRef<Lot[]>([])

  const reset = useCallback(() => {
    lotsRef.current = []
    setState(createInitial())
  }, [])

  const applyCash = useCallback((delta: number) => {
    setState((prev) => ({ ...prev, cash: prev.cash + delta }))
  }, [])

  const appendRounds = useCallback((rounds: ClosedRound[]) => {
    if (!rounds.length) return
    setState((prev) => ({
      ...prev,
      closedRounds: [...prev.closedRounds, ...rounds],
    }))
  }, [])

  const buy = useCallback(
    (price: number, qty: number, candleIndex: number, time: string) => {
      if (qty <= 0 || price <= 0) {
        return { ok: false as const, reason: '數量或價格無效' }
      }
      const prev = stateRef.current
      const cost = price * qty
      if (cost > prev.cash) return { ok: false as const, reason: '現金不足' }

      // 空單優先回補
      if (prev.qty < 0) {
        const shortQty = -prev.qty
        const coverQty = Math.min(qty, shortQty)
        const leftover = qty - coverQty
        const closed = closeLotsFifo(
          lotsRef.current,
          coverQty,
          price,
          time,
          'short',
        )
        lotsRef.current = closed.remaining

        const afterCoverQty = prev.qty + coverQty
        let nextQty = afterCoverQty
        let nextAvg = afterCoverQty === 0 ? 0 : avgFromLots(lotsRef.current)
        const trades = [
          ...prev.trades,
          makeTrade('cover', price, coverQty, candleIndex, time),
        ]

        if (leftover > 0) {
          lotsRef.current = [{ qty: leftover, price, time }]
          nextQty = leftover
          nextAvg = price
          trades.push(makeTrade('buy', price, leftover, candleIndex, time))
        } else if (afterCoverQty === 0) {
          lotsRef.current = []
        }

        setState({
          ...prev,
          qty: nextQty,
          avgCost: nextAvg,
          cash: prev.cash - cost,
          realizedPnl: prev.realizedPnl + closed.realized,
          trades,
          closedRounds: [...prev.closedRounds, ...closed.rounds],
        })
        return {
          ok: true as const,
          note:
            leftover > 0
              ? `回補 ${coverQty} 股後轉多 ${leftover} 股`
              : `回補 ${coverQty} 股`,
        }
      }

      lotsRef.current = [...lotsRef.current, { qty, price, time }]
      const newQty = prev.qty + qty
      const newAvg = avgFromLots(lotsRef.current)
      setState({
        ...prev,
        qty: newQty,
        avgCost: newAvg,
        cash: prev.cash - cost,
        trades: [
          ...prev.trades,
          makeTrade('buy', price, qty, candleIndex, time),
        ],
      })
      return { ok: true as const, note: `買進 ${qty} 股` }
    },
    [],
  )

  const sell = useCallback(
    (price: number, qty: number, candleIndex: number, time: string) => {
      if (qty <= 0 || price <= 0) {
        return { ok: false as const, reason: '數量或價格無效' }
      }
      const prev = stateRef.current
      const proceeds = price * qty

      // 已放空或空手：加空
      if (prev.qty <= 0) {
        lotsRef.current = [...lotsRef.current, { qty, price, time }]
        const shortQty = -prev.qty
        const newShort = shortQty + qty
        const newAvg = avgFromLots(lotsRef.current)
        setState({
          ...prev,
          qty: -newShort,
          avgCost: newAvg,
          cash: prev.cash + proceeds,
          trades: [
            ...prev.trades,
            makeTrade('short', price, qty, candleIndex, time),
          ],
        })
        return { ok: true as const, note: `放空 ${qty} 股` }
      }

      // 有多單：先賣多，超量轉放空
      const longSell = Math.min(qty, prev.qty)
      const shortExtra = qty - longSell
      const closed = closeLotsFifo(
        lotsRef.current,
        longSell,
        price,
        time,
        'long',
      )
      lotsRef.current = closed.remaining

      const trades = [
        ...prev.trades,
        makeTrade('sell', price, longSell, candleIndex, time),
      ]

      let nextQty = prev.qty - longSell
      let nextAvg = nextQty === 0 ? 0 : avgFromLots(lotsRef.current)

      if (shortExtra > 0) {
        lotsRef.current = [{ qty: shortExtra, price, time }]
        nextQty = -shortExtra
        nextAvg = price
        trades.push(makeTrade('short', price, shortExtra, candleIndex, time))
      } else if (nextQty === 0) {
        lotsRef.current = []
      }

      setState({
        ...prev,
        qty: nextQty,
        avgCost: nextAvg,
        cash: prev.cash + proceeds,
        realizedPnl: prev.realizedPnl + closed.realized,
        trades,
        closedRounds: [...prev.closedRounds, ...closed.rounds],
      })

      return {
        ok: true as const,
        note:
          shortExtra > 0
            ? `賣出 ${longSell} 股後放空 ${shortExtra} 股`
            : `賣出 ${longSell} 股`,
      }
    },
    [],
  )

  const equity = useCallback(
    (mark: number) => state.cash + state.qty * mark,
    [state.cash, state.qty],
  )

  const unrealized = useCallback(
    (mark: number) => {
      if (state.qty === 0) return 0
      if (state.qty > 0) return (mark - state.avgCost) * state.qty
      return (state.avgCost - mark) * -state.qty
    },
    [state.avgCost, state.qty],
  )

  const summary = useMemo(
    () => ({
      initialCash: INITIAL_CASH,
      ...state,
    }),
    [state],
  )

  return {
    state: summary,
    buy,
    sell,
    reset,
    applyCash,
    appendRounds,
    equity,
    unrealized,
  }
}

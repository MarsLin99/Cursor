import { useCallback, useMemo, useRef, useState } from 'react'
import type { PositionState, Trade } from '../types'

const INITIAL_CASH = 4_000_000

function createInitial(): PositionState {
  return {
    qty: 0,
    avgCost: 0,
    cash: INITIAL_CASH,
    realizedPnl: 0,
    trades: [],
  }
}

export function usePaperTrade() {
  const [state, setState] = useState<PositionState>(createInitial)
  const stateRef = useRef(state)
  stateRef.current = state

  const reset = useCallback(() => setState(createInitial()), [])

  const buy = useCallback(
    (price: number, qty: number, candleIndex: number, time: string) => {
      if (qty <= 0 || price <= 0) {
        return { ok: false as const, reason: '數量或價格無效' }
      }
      const prev = stateRef.current
      const cost = price * qty
      if (cost > prev.cash) return { ok: false as const, reason: '現金不足' }

      const newQty = prev.qty + qty
      const newAvg =
        newQty === 0 ? 0 : (prev.avgCost * prev.qty + cost) / newQty
      const trade: Trade = {
        id: `${time}-B-${qty}-${Math.random().toString(36).slice(2, 7)}`,
        side: 'buy',
        price,
        qty,
        candleIndex,
        time,
      }
      setState({
        ...prev,
        qty: newQty,
        avgCost: newAvg,
        cash: prev.cash - cost,
        trades: [...prev.trades, trade],
      })
      return { ok: true as const }
    },
    [],
  )

  const sell = useCallback(
    (price: number, qty: number, candleIndex: number, time: string) => {
      if (qty <= 0 || price <= 0) {
        return { ok: false as const, reason: '數量或價格無效' }
      }
      const prev = stateRef.current
      if (qty > prev.qty) return { ok: false as const, reason: '持股不足' }

      const proceeds = price * qty
      const costBasis = prev.avgCost * qty
      const realized = proceeds - costBasis
      const trade: Trade = {
        id: `${time}-S-${qty}-${Math.random().toString(36).slice(2, 7)}`,
        side: 'sell',
        price,
        qty,
        candleIndex,
        time,
      }
      setState({
        ...prev,
        qty: prev.qty - qty,
        avgCost: prev.qty - qty === 0 ? 0 : prev.avgCost,
        cash: prev.cash + proceeds,
        realizedPnl: prev.realizedPnl + realized,
        trades: [...prev.trades, trade],
      })
      return { ok: true as const }
    },
    [],
  )

  const equity = useCallback(
    (mark: number) => state.cash + state.qty * mark,
    [state.cash, state.qty],
  )

  const unrealized = useCallback(
    (mark: number) =>
      state.qty === 0 ? 0 : (mark - state.avgCost) * state.qty,
    [state.avgCost, state.qty],
  )

  const summary = useMemo(
    () => ({
      initialCash: INITIAL_CASH,
      ...state,
    }),
    [state],
  )

  return { state: summary, buy, sell, reset, equity, unrealized }
}

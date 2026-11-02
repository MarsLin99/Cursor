import type { ClosedRound } from '../types'
import { formatPct } from './format'

export type WinStats = {
  trades: number
  wins: number
  losses: number
  flats: number
  winRate: number | null
  totalPnl: number
  avgWin: number
  avgLoss: number
  profitFactor: number | null
}

export type YearPerformance = {
  year: string
  trades: number
  wins: number
  winRate: number | null
  realizedPnl: number
  returnPct: number
}

export type PerformanceSummary = {
  overall: WinStats
  spot: WinStats
  option: WinStats
  byYear: YearPerformance[]
}

function emptyStats(): WinStats {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    flats: 0,
    winRate: null,
    totalPnl: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: null,
  }
}

export function summarizeRounds(rounds: ClosedRound[]): WinStats {
  const stats = emptyStats()
  if (!rounds.length) return stats

  let winSum = 0
  let lossSum = 0
  for (const r of rounds) {
    stats.trades += 1
    stats.totalPnl += r.pnl
    if (r.pnl > 0) {
      stats.wins += 1
      winSum += r.pnl
    } else if (r.pnl < 0) {
      stats.losses += 1
      lossSum += r.pnl
    } else {
      stats.flats += 1
    }
  }

  const decided = stats.wins + stats.losses
  stats.winRate = decided > 0 ? stats.wins / decided : null
  stats.avgWin = stats.wins > 0 ? winSum / stats.wins : 0
  stats.avgLoss = stats.losses > 0 ? lossSum / stats.losses : 0
  stats.profitFactor =
    lossSum < 0 ? winSum / Math.abs(lossSum) : stats.wins > 0 ? null : null
  // profitFactor: if no losses but has wins, treat as Infinity -> null display as "—" with note; use a large sentinel
  if (lossSum === 0 && winSum > 0) stats.profitFactor = Number.POSITIVE_INFINITY
  if (lossSum === 0 && winSum === 0) stats.profitFactor = null

  return stats
}

export function buildPerformance(
  rounds: ClosedRound[],
  initialCash: number,
): PerformanceSummary {
  const overall = summarizeRounds(rounds)
  const spot = summarizeRounds(rounds.filter((r) => r.kind === 'spot'))
  const option = summarizeRounds(rounds.filter((r) => r.kind === 'option'))

  const yearMap = new Map<string, ClosedRound[]>()
  for (const r of rounds) {
    const year = r.closeTime.slice(0, 4)
    const list = yearMap.get(year) ?? []
    list.push(r)
    yearMap.set(year, list)
  }

  const byYear = [...yearMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, list]) => {
      const s = summarizeRounds(list)
      return {
        year,
        trades: s.trades,
        wins: s.wins,
        winRate: s.winRate,
        realizedPnl: s.totalPnl,
        returnPct: initialCash > 0 ? (s.totalPnl / initialCash) * 100 : 0,
      }
    })

  return { overall, spot, option, byYear }
}

export function formatWinRate(rate: number | null): string {
  if (rate == null) return '—'
  return formatPct(rate * 100, 1)
}

export function formatProfitFactor(pf: number | null): string {
  if (pf == null) return '—'
  if (!Number.isFinite(pf)) return '∞'
  return pf.toFixed(2)
}

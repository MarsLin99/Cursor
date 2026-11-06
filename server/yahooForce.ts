import type { SparkFlow } from '../src/desk/types.ts'

/** Yahoo is authoritative. A missing minute carries the last observed totals, never a candle estimate. */
export function yahooForceSeries(
  samples: Record<string, [number, number]>,
  taishin: Map<number, number>,
  endMinute: number,
) {
  const OPEN = 9 * 60, FREEZE = 13 * 60 + 25
  const minute = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const stamp = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + ':00'
  const observed = new Map(Object.entries(samples).map(([t, pair]) => [minute(t), pair] as const)
    .filter(([m, pair]) => m >= OPEN && m < FREEZE && pair.every(Number.isFinite)))
  const first = observed.size ? Math.min(...observed.keys()) : null
  // Taishin deltas are used only to reconstruct the shape BEFORE the first Yahoo sample.
  const tsAt = new Map<number, number>()
  let ts = 0
  for (let m = OPEN; m <= Math.min(endMinute, FREEZE - 1); m++) {
    ts += taishin.get(m) ?? 0
    tsAt.set(m, ts)
  }
  const firstPair = first == null ? null : observed.get(first)!
  const offset = firstPair && first != null ? firstPair[0] - firstPair[1] - (tsAt.get(first) ?? 0) : 0
  const flow: SparkFlow[] = []
  if (!observed.size && !taishin.size) return { flow, force: [], cum: 0, yahooMinutes: 0, estMinutes: 0, carriedMinutes: 0, yahooNet: null, yahooAt: null }
  let previous = 0, lastPair: [number, number] | null = null
  let yahooMinutes = 0, estMinutes = 0, carriedMinutes = 0
  for (let m = OPEN; m <= endMinute; m++) {
    let cum: number, out: number | null = null, inn: number | null = null
    let src: SparkFlow['src']
    if (first != null && m >= first) {
      const pair = m < FREEZE ? observed.get(m) : undefined
      if (pair) {
        cum = pair[0] - pair[1]
        if (lastPair) { out = pair[0] - lastPair[0]; inn = pair[1] - lastPair[1] }
        else if (m === OPEN) { out = pair[0]; inn = pair[1] }
        // First late sample has unknown per-minute out/inner: do not fabricate them.
        lastPair = pair
      } else {
        cum = previous; out = 0; inn = 0; carriedMinutes++
      }
      src = 'yahoo'; yahooMinutes++
    } else {
      if (!taishin.size) continue
      // No Yahoo samples yet: provisional Taishin shape only, explicitly marked estimate.
      cum = (tsAt.get(Math.min(m, FREEZE - 1)) ?? 0) + offset
      src = 'est'; estMinutes++
    }
    flow.push({ t: stamp(m), out, inn, net: cum - previous, cum, src })
    previous = cum
  }
  const last = [...observed.entries()].sort((a,b) => a[0]-b[0]).at(-1)
  return { flow, force: flow.map(r => ({ t: r.t, d: r.cum! })), cum: previous,
    yahooMinutes, estMinutes, carriedMinutes,
    yahooNet: last ? last[1][0] - last[1][1] : null,
    yahooAt: last ? stamp(last[0]) : null }
}

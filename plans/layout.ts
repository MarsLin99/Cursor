/**
 * L 型配置 — 建蔽用滿約 19.2 坪
 * 原點西南角；y 自臨路南側往北；單位 m
 *
 * 建蔽上限：105.5 × 60% = 63.3㎡ ≈ 19.15 坪
 * 本案建築面積：62.9㎡ ≈ 19.0 坪（建蔽約 59.6%）
 */
export const site = {
  south: 10,
  north: 9,
  west: 11.2,
  east: 11,
  areaM2: 105.5,
  maxCoverageM2: 63.3,
  maxCoveragePing: 19.1,
} as const

/**
 * 西翼（南北向，臨西界）+ 北翼（東西向）
 * 中庭在 L 彎內；車位／靈活在南側、中庭前方橫向並排
 */
export const buildingFootprint = {
  /** 4.2 × 10.8 = 45.36 */
  westWing: { x: 0.4, y: 0.3, w: 4.2, d: 10.8 },
  /** 9.2 × 3.5 = 32.20 */
  northWing: { x: 0.4, y: 7.6, w: 9.2, d: 3.5 },
} as const

/** 45.36 + 32.20 − 4.2×3.5(14.70) = 62.86 → 62.9 */
export const buildingAreaM2 = 62.9
export const buildingAreaPing = 19.0
export const coveragePct = 59.6

/** 露天中庭（不計建蔽）3.4 × 3.0 = 10.2 */
export const courtyard = { x: 4.6, y: 4.6, w: 3.4, d: 3.0 } as const
export const courtyardM2 = 10.2

export const eaveDepth = 1.5

/** 中庭南側橫向並排 */
export const parking = {
  fixed: { x: 4.6, y: 0.2, w: 2.7, d: 4.3 },
  flex: { x: 7.3, y: 0.2, w: 2.5, d: 4.3 },
} as const

/** 一樓房間（寬×深＝標註面積，已核對） */
export const rooms1F = {
  genkan: { w: 2.0, d: 2.1, area: 4.2 },
  ldk: { w: 4.2, d: 5.2, area: 21.8 },
  washitsu: { w: 3.2, d: 3.5, area: 11.2 },
  bath: { w: 1.8, d: 2.2, area: 4.0 },
  stair: { w: 2.2, d: 3.5, area: 7.7 },
  storage: { w: 1.5, d: 2.1, area: 3.2 },
  utility: { w: 2.0, d: 2.0, area: 4.0 },
} as const

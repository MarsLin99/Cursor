/**
 * 約 32 坪基地 L 型配置（法規示意）
 * 單位：公尺；原點為西南角（臨路南側）
 *
 * 基地近似：南 10、北 9、西 11.2、東 11 → 約 105.5 m²
 * 建蔽率 60% → 建築面積上限約 63.3 m²
 */

export const PING = 3.3058

export const site = {
  south: 10,
  north: 9,
  west: 11.2,
  east: 11,
  areaM2: 105.5,
} as const

/** 建築本體（外牆中心線以內）＝計入建築面積 */
export const buildingFootprint = {
  /** 西翼：南北向 */
  westWing: { x: 0.4, y: 4.6, w: 4.4, d: 6.4 },
  /** 北翼：東西向（與西翼於西北角重疊） */
  northWing: { x: 0.4, y: 7.6, w: 8.2, d: 3.4 },
} as const

function rectArea(r: { w: number; d: number }): number {
  return r.w * r.d
}

const overlap = {
  w: buildingFootprint.westWing.w,
  d: buildingFootprint.northWing.d,
}

/** 計入建蔽之建築面積 */
/** 西翼 4.4×6.4 + 北翼 8.2×3.4 − 重疊 4.4×3.4 = 41.1 */
export const buildingAreaM2 = Number(
  (
    rectArea(buildingFootprint.westWing) +
    rectArea(buildingFootprint.northWing) -
    overlap.w * overlap.d
  ).toFixed(1),
) // 41.1

/** 無屋頂中庭（L 內側）＝不計建築面積 */
export const courtyard = {
  x: 4.8,
  y: 4.6,
  w: 3.8,
  d: 3.0,
  note: '露天植栽／透光中庭，無屋頂，不計建築面積',
} as const

export const courtyardM2 = Number((courtyard.w * courtyard.d).toFixed(1))

/**
 * 內側屋簷／外廊（自外牆中心線向外突出 ≤ 2.0m）
 * 依建築技術規則設計施工編 §1 第3款：屋簷突出原則上以 2m 為計入界線
 */
export const eaveWalk = {
  depth: 1.5,
  note: 'L 內側屋簷外廊 1.5m（≤2m），設計為外牆外之屋簷／陽臺突出，原則不另計建築面積',
} as const

/** 臨路停車 */
export const parking = {
  fixed: { x: 0.4, y: 0.3, w: 2.7, d: 5.2, label: '固定車位（可設通透遮陽）' },
  flex: { x: 5.0, y: 0.3, w: 3.6, d: 4.2, label: '靈活空間（露天）' },
} as const

export const coveragePct = Number(((buildingAreaM2 / site.areaM2) * 100).toFixed(1))
export const maxCoverageM2 = Number((site.areaM2 * 0.6).toFixed(1))

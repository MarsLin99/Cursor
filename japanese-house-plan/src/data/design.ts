/** 基地與法規計算常數（1 坪 = 3.3058 m²） */
export const PING = 3.3058

export const site = {
  north: 9,
  south: 10,
  west: 11.2,
  east: 11,
  /** 以梯形近似：平均寬 × 平均深 */
  areaM2: Number((((9 + 10) / 2) * ((11.2 + 11) / 2)).toFixed(1)),
} as const

export const sitePing = Number((site.areaM2 / PING).toFixed(1))

export const regulation = {
  coverageRatio: 0.6,
  floorAreaRatio: 2.2,
  maxCoverageM2: Number((site.areaM2 * 0.6).toFixed(1)),
  maxFloorAreaM2: Number((site.areaM2 * 2.2).toFixed(1)),
} as const

/** 建築本體：側邊停車方案，最大化進深 */
export const building = {
  width: 6.5,
  depth: 9.5,
  floors: 2,
  floorHeight: 2.9,
  get footprintM2() {
    return Number((this.width * this.depth).toFixed(1))
  },
  get totalFloorM2() {
    return Number((this.footprintM2 * this.floors).toFixed(1))
  },
} as const

export const buildingPing = Number((building.footprintM2 / PING).toFixed(1))
export const totalFloorPing = Number((building.totalFloorM2 / PING).toFixed(1))

export const coverageUsed = Number(
  ((building.footprintM2 / site.areaM2) * 100).toFixed(1),
)
export const farUsed = Number(
  ((building.totalFloorM2 / site.areaM2) * 100).toFixed(1),
)

export const parking = {
  fixed: { width: 2.6, depth: 5.5, label: '固定車位' },
  flexible: { width: 2.6, depth: 5.0, label: '靈活空間' },
} as const

export type Room = {
  id: string
  name: string
  areaM2: number
  note?: string
}

export const floor1Rooms: Room[] = [
  { id: 'genkan', name: '玄關', areaM2: 3.2, note: '含鞋櫃・土間' },
  { id: 'ldk', name: '客廳／餐廳／廚房', areaM2: 24.5, note: '開放式 LDK' },
  { id: 'washitsu', name: '和室', areaM2: 7.3, note: '約 4.5 疊・可彈性' },
  { id: 'bath1', name: '衛浴', areaM2: 3.0 },
  { id: 'storage', name: '儲藏', areaM2: 1.8 },
  { id: 'stair', name: '樓梯間', areaM2: 6.5 },
  { id: 'engawa', name: '緣側／走廊', areaM2: 4.2 },
]

export const floor2Rooms: Room[] = [
  { id: 'master', name: '主臥室', areaM2: 12.5, note: '含更衣區' },
  { id: 'bedA', name: '次臥 A', areaM2: 8.5 },
  { id: 'bedB', name: '次臥 B', areaM2: 8.0 },
  { id: 'bath2', name: '衛浴', areaM2: 4.5, note: '乾濕分離' },
  { id: 'laundry', name: '洗衣間', areaM2: 2.8 },
  { id: 'balcony', name: '陽台', areaM2: 4.0, note: '晒衣・空調外機' },
  { id: 'stair2', name: '樓梯間', areaM2: 6.5 },
  { id: 'hall', name: '走廊', areaM2: 3.8 },
]

export const designConcept = {
  title: '側院停車・日式兩層透天',
  subtitle: '建蔽率 60%／容積率 220% 合規方案',
  highlights: [
    '西側配置固定車位＋靈活空間，臨路進出便利',
    '建築本體偏東側，進深 9.5m，爭取室內連續感',
    '一樓開放 LDK＋和室，二樓三房兩衛格局',
    '切妻屋根铺設太陽光電屋瓦，兼具發電與遮陽',
  ],
} as const

export const visuals = [
  {
    id: 'exterior',
    title: '臨路外觀',
    caption: '白牆・杉木材質・太陽屋瓦，固定車位與靈活前庭並陳',
    src: '/visuals/exterior-3d.jpg',
  },
  {
    id: 'aerial',
    title: '鳥瞰配置',
    caption: '側邊停車帶＋建築本體＋北側後院，完整呈現約 32 坪基地尺度',
    src: '/visuals/aerial-3d.jpg',
  },
  {
    id: 'interior',
    title: '一樓 LDK',
    caption: '開放式客餐廚，以人物尺度感受實際空間量體',
    src: '/visuals/interior-ldk.jpg',
  },
  {
    id: 'site',
    title: '基地配置圖',
    caption: '梯形基地與建築、車位相對關係',
    src: '/visuals/site-plan.jpg',
  },
  {
    id: 'f1',
    title: '一樓示意平面',
    caption: '玄關・LDK・和室・衛浴',
    src: '/visuals/floor-1f.jpg',
  },
  {
    id: 'f2',
    title: '二樓示意平面',
    caption: '主臥・次臥・衛浴・陽台',
    src: '/visuals/floor-2f.jpg',
  },
] as const

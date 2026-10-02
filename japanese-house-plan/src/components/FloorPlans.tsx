import {
  building,
  parking,
  site,
} from '../data/design'

const SCALE = 42

type Point = [number, number]

/** 將基地梯形座標化（南邊為臨路、置於下方） */
function sitePolygon(): Point[] {
  const wS = site.south * SCALE
  const wN = site.north * SCALE
  const dW = site.west * SCALE
  const offset = (wS - wN) / 2
  return [
    [0, dW],
    [wS, site.east * SCALE],
    [offset + wN, 0],
    [offset, 0],
  ]
}

/**
 * 基地配置 SVG：建築偏東、西側停車帶
 */
export function SitePlanSvg() {
  const pad = 48
  const poly = sitePolygon()
  const maxX = Math.max(...poly.map((p) => p[0]))
  const maxY = Math.max(...poly.map((p) => p[1]))
  const vbW = maxX + pad * 2
  const vbH = maxY + pad * 2

  const buildX = pad + parking.fixed.width * SCALE + 0.4 * SCALE
  const buildY = pad + 0.8 * SCALE
  const buildW = building.width * SCALE
  const buildD = building.depth * SCALE

  const parkX = pad + 0.15 * SCALE
  const parkW = parking.fixed.width * SCALE
  const fixedY = pad + maxY - parking.fixed.depth * SCALE - 0.3 * SCALE
  const flexY = pad + 0.8 * SCALE

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="h-auto w-full"
      role="img"
      aria-label="基地配置平面圖"
    >
      <defs>
        <pattern id="gravel" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="3" r="0.8" fill="#c4b8a5" opacity="0.5" />
          <circle cx="6" cy="6" r="0.6" fill="#b7ab98" opacity="0.4" />
        </pattern>
      </defs>

      <rect width={vbW} height={vbH} fill="#f7f4ef" />

      <polygon
        points={poly.map(([x, y]) => `${x + pad},${y + pad}`).join(' ')}
        fill="#e8e4db"
        stroke="#2f2a26"
        strokeWidth="2"
      />

      {/* 後院 */}
      <rect
        x={buildX}
        y={pad + 0.15 * SCALE}
        width={buildW}
        height={0.65 * SCALE}
        fill="#6b7f56"
        opacity="0.35"
      />
      <text
        x={buildX + buildW / 2}
        y={pad + 0.5 * SCALE}
        textAnchor="middle"
        fontSize="11"
        fill="#3f4d32"
      >
        後院庭園
      </text>

      {/* 建築 */}
      <rect
        x={buildX}
        y={buildY}
        width={buildW}
        height={buildD}
        fill="#d6c4a1"
        stroke="#5c4a1f"
        strokeWidth="2"
      />
      <text
        x={buildX + buildW / 2}
        y={buildY + buildD / 2 - 8}
        textAnchor="middle"
        fontSize="14"
        fontWeight="600"
        fill="#3d3218"
      >
        建築本體
      </text>
      <text
        x={buildX + buildW / 2}
        y={buildY + buildD / 2 + 12}
        textAnchor="middle"
        fontSize="12"
        fill="#5c4a1f"
      >
        {building.width}×{building.depth}m
      </text>
      <text
        x={buildX + buildW / 2}
        y={buildY + buildD / 2 + 28}
        textAnchor="middle"
        fontSize="11"
        fill="#6b6254"
      >
        {building.footprintM2} m²（約 {(building.footprintM2 / 3.3058).toFixed(1)} 坪）
      </text>

      {/* 固定車位 */}
      <rect
        x={parkX}
        y={fixedY}
        width={parkW}
        height={parking.fixed.depth * SCALE}
        fill="#cfd4d8"
        stroke="#4b5563"
        strokeWidth="1.5"
        strokeDasharray="6 4"
      />
      <text
        x={parkX + parkW / 2}
        y={fixedY + parking.fixed.depth * SCALE / 2}
        textAnchor="middle"
        fontSize="12"
        fill="#1f2937"
      >
        固定車位
      </text>

      {/* 靈活空間 */}
      <rect
        x={parkX}
        y={flexY}
        width={parkW}
        height={parking.flexible.depth * SCALE}
        fill="url(#gravel)"
        stroke="#6b7f56"
        strokeWidth="1.5"
      />
      <text
        x={parkX + parkW / 2}
        y={flexY + parking.flexible.depth * SCALE / 2 - 6}
        textAnchor="middle"
        fontSize="12"
        fill="#3f4d32"
      >
        靈活空間
      </text>
      <text
        x={parkX + parkW / 2}
        y={flexY + parking.flexible.depth * SCALE / 2 + 10}
        textAnchor="middle"
        fontSize="10"
        fill="#5a6b4a"
      >
        車位／庭／工作
      </text>

      {/* 尺寸標註 */}
      <Dimension
        x1={pad}
        y1={pad + maxY + 18}
        x2={pad + site.south * SCALE}
        y2={pad + maxY + 18}
        label={`南 ${site.south}m（臨路）`}
      />
      <Dimension
        x1={pad - 18}
        y1={pad}
        x2={pad - 18}
        y2={pad + site.west * SCALE}
        label={`西 ${site.west}m`}
        vertical
      />
      <text x={pad + maxX / 2} y={22} textAnchor="middle" fontSize="12" fill="#44403c">
        北 {site.north}m
      </text>
      <text
        x={pad + maxX + 14}
        y={pad + maxY / 2}
        textAnchor="middle"
        fontSize="12"
        fill="#44403c"
        transform={`rotate(90 ${pad + maxX + 14} ${pad + maxY / 2})`}
      >
        東 {site.east}m
      </text>

      {/* 北向 */}
      <g transform={`translate(${vbW - 36}, 36)`}>
        <circle r="16" fill="#fff" stroke="#2f2a26" strokeWidth="1.2" />
        <polygon points="0,-10 4,6 -4,6" fill="#2f2a26" />
        <text y="20" textAnchor="middle" fontSize="10" fill="#2f2a26">
          N
        </text>
      </g>
    </svg>
  )
}

type DimProps = {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  vertical?: boolean
}

function Dimension({ x1, y1, x2, y2, label, vertical }: DimProps) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    <g stroke="#78716c" fill="#57534e">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1" />
      {!vertical && (
        <>
          <line x1={x1} y1={y1 - 4} x2={x1} y2={y1 + 4} strokeWidth="1" />
          <line x1={x2} y1={y2 - 4} x2={x2} y2={y2 + 4} strokeWidth="1" />
          <text x={mx} y={my + 14} textAnchor="middle" fontSize="11" stroke="none">
            {label}
          </text>
        </>
      )}
      {vertical && (
        <>
          <line x1={x1 - 4} y1={y1} x2={x1 + 4} y2={y1} strokeWidth="1" />
          <line x1={x2 - 4} y1={y2} x2={x2 + 4} y2={y2} strokeWidth="1" />
          <text
            x={mx - 12}
            y={my}
            textAnchor="middle"
            fontSize="11"
            stroke="none"
            transform={`rotate(-90 ${mx - 12} ${my})`}
          >
            {label}
          </text>
        </>
      )}
    </g>
  )
}

type FloorRoom = {
  name: string
  x: number
  y: number
  w: number
  h: number
  fill: string
  area: string
}

const floor1Layout: FloorRoom[] = [
  { name: '玄關', x: 0.2, y: 7.6, w: 2.0, h: 1.7, fill: '#e8dfd0', area: '3.2㎡' },
  { name: '客廳・餐廳・廚房', x: 2.2, y: 4.8, w: 4.1, h: 4.5, fill: '#f0e6d4', area: '24.5㎡' },
  { name: '和室', x: 3.6, y: 0.3, w: 2.7, h: 2.7, fill: '#d9e0c8', area: '7.3㎡' },
  { name: '衛浴', x: 2.2, y: 0.3, w: 1.4, h: 2.2, fill: '#d5dde3', area: '3.0㎡' },
  { name: '儲藏', x: 2.2, y: 2.5, w: 1.4, h: 1.3, fill: '#e4d9c8', area: '1.8㎡' },
  { name: '樓梯', x: 0.2, y: 3.2, w: 2.0, h: 3.2, fill: '#ddd2c0', area: '6.5㎡' },
  { name: '緣側', x: 0.2, y: 0.3, w: 2.0, h: 2.9, fill: '#ebe4d4', area: '走廊' },
]

const floor2Layout: FloorRoom[] = [
  { name: '主臥室', x: 2.0, y: 0.3, w: 4.3, h: 3.0, fill: '#f0e6d4', area: '12.5㎡' },
  { name: '次臥 A', x: 3.4, y: 5.5, w: 2.9, h: 3.7, fill: '#e8dfd0', area: '8.5㎡' },
  { name: '次臥 B', x: 0.2, y: 6.4, w: 3.2, h: 2.8, fill: '#e4d9c8', area: '8.0㎡' },
  { name: '衛浴', x: 0.2, y: 3.4, w: 1.8, h: 2.5, fill: '#d5dde3', area: '4.5㎡' },
  { name: '洗衣', x: 2.0, y: 3.3, w: 1.4, h: 2.0, fill: '#d9e0c8', area: '2.8㎡' },
  { name: '陽台', x: 3.4, y: 3.3, w: 2.9, h: 2.2, fill: '#cfd8cf', area: '4.0㎡' },
  { name: '樓梯', x: 0.2, y: 0.3, w: 1.8, h: 3.1, fill: '#ddd2c0', area: '6.5㎡' },
]

type FloorPlanProps = {
  floor: 1 | 2
}

/**
 * 樓層精確平面 SVG（單位：公尺）
 */
export function FloorPlanSvg({ floor }: FloorPlanProps) {
  const rooms = floor === 1 ? floor1Layout : floor2Layout
  const pad = 36
  const w = building.width * SCALE
  const d = building.depth * SCALE

  return (
    <svg
      viewBox={`0 0 ${w + pad * 2} ${d + pad * 2}`}
      className="h-auto w-full"
      role="img"
      aria-label={floor === 1 ? '一樓平面圖' : '二樓平面圖'}
    >
      <rect width={w + pad * 2} height={d + pad * 2} fill="#f7f4ef" />
      <rect
        x={pad}
        y={pad}
        width={w}
        height={d}
        fill="#f3eee5"
        stroke="#2f2a26"
        strokeWidth="2.5"
      />

      {rooms.map((room) => (
        <g key={room.name}>
          <rect
            x={pad + room.x * SCALE}
            y={pad + room.y * SCALE}
            width={room.w * SCALE}
            height={room.h * SCALE}
            fill={room.fill}
            stroke="#5c5346"
            strokeWidth="1.2"
          />
          <text
            x={pad + (room.x + room.w / 2) * SCALE}
            y={pad + (room.y + room.h / 2) * SCALE - 6}
            textAnchor="middle"
            fontSize={room.w < 2 ? 10 : 13}
            fontWeight="600"
            fill="#2f2a26"
          >
            {room.name}
          </text>
          <text
            x={pad + (room.x + room.w / 2) * SCALE}
            y={pad + (room.y + room.h / 2) * SCALE + 12}
            textAnchor="middle"
            fontSize="11"
            fill="#6b6254"
          >
            {room.area}
          </text>
        </g>
      ))}

      <text x={pad} y={20} fontSize="13" fontWeight="600" fill="#2f2a26">
        {floor === 1 ? '一樓平面' : '二樓平面'}・{building.width}×{building.depth}m
      </text>
      <text x={pad + w} y={d + pad + 24} textAnchor="end" fontSize="11" fill="#78716c">
        比例尺約 1:{Math.round(1000 / SCALE)}（示意）
      </text>
    </svg>
  )
}

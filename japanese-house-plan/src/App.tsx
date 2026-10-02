import { motion } from 'framer-motion'
import { useState } from 'react'
import { FloorPlanSvg, SitePlanSvg } from './components/FloorPlans'
import { HouseScene } from './components/HouseScene'
import {
  building,
  buildingPing,
  coverageUsed,
  designConcept,
  farUsed,
  floor1Rooms,
  floor2Rooms,
  regulation,
  site,
  sitePing,
  totalFloorPing,
  visuals,
} from './data/design'

type Tab = 'site' | '1f' | '2f' | '3d'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'site', label: '基地配置' },
  { id: '1f', label: '一樓平面' },
  { id: '2f', label: '二樓平面' },
  { id: '3d', label: '3D 量體' },
]

/**
 * 日式兩層透天規劃展示首頁
 */
export default function App() {
  const [tab, setTab] = useState<Tab>('site')
  const [lightbox, setLightbox] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8 md:pt-12">
      <header className="relative overflow-hidden rounded-sm border border-stone-300/60 bg-[linear-gradient(135deg,#f7f4ef_0%,#e8efe4_48%,#dfe8e4_100%)] px-6 py-10 md:px-12 md:py-14">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <p className="text-sm tracking-[0.28em] text-[var(--moss)]">約 {sitePing} 坪都市基地</p>
          <h1 className="font-display mt-3 max-w-3xl text-4xl leading-tight text-[var(--charcoal)] md:text-6xl">
            日式兩層透天
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--ink-soft)] md:text-lg">
            {designConcept.subtitle}。側邊配置固定車位與靈活空間，屋頂採用太陽屋瓦，
            在緊湊基地中爭取明快、安靜的居住尺度。
          </p>
        </motion.div>

        <motion.div
          className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.6 }}
        >
          {[
            { k: '基地面積', v: `${site.areaM2} m²`, s: `${sitePing} 坪` },
            { k: '建築面積', v: `${building.footprintM2} m²`, s: `${buildingPing} 坪・建蔽 ${coverageUsed}%` },
            { k: '總樓地板', v: `${building.totalFloorM2} m²`, s: `${totalFloorPing} 坪・容積 ${farUsed}%` },
            { k: '法規上限', v: `建蔽 ${regulation.maxCoverageM2} m²`, s: `容積 ${regulation.maxFloorAreaM2} m²` },
          ].map((item) => (
            <div key={item.k} className="border border-stone-400/30 bg-white/50 px-3 py-3 backdrop-blur-sm">
              <div className="text-xs text-stone-500">{item.k}</div>
              <div className="font-display mt-1 text-lg text-[var(--charcoal)]">{item.v}</div>
              <div className="text-xs text-stone-600">{item.s}</div>
            </div>
          ))}
        </motion.div>
      </header>

      <section className="mt-10 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <div className="border border-stone-300/70 bg-[#f7f4ef]/90 p-4 md:p-6">
          <div className="mb-4 flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-1.5 text-sm transition ${
                  tab === item.id
                    ? 'bg-[var(--charcoal)] text-[#f7f4ef]'
                    : 'bg-white/70 text-stone-700 hover:bg-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="plan-grid min-h-[360px] border border-stone-200 bg-white/60 p-2 md:min-h-[480px]">
            {tab === 'site' && <SitePlanSvg />}
            {tab === '1f' && <FloorPlanSvg floor={1} />}
            {tab === '2f' && <FloorPlanSvg floor={2} />}
            {tab === '3d' && <HouseScene />}
          </div>
          {tab === '3d' && (
            <p className="mt-3 text-sm text-stone-600">拖曳旋轉檢視量體・屋頂深色區塊為太陽屋瓦示意</p>
          )}
        </div>

        <aside className="space-y-6">
          <div className="border border-stone-300/70 bg-white/55 p-5">
            <h2 className="font-display text-2xl text-[var(--charcoal)]">{designConcept.title}</h2>
            <ul className="mt-4 space-y-3">
              {designConcept.highlights.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-relaxed text-stone-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--moss)]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <RoomList title="一樓空間" rooms={floor1Rooms} />
          <RoomList title="二樓空間" rooms={floor2Rooms} />

          <div className="border border-stone-300/70 bg-[#eef2ea] p-5 text-sm leading-relaxed text-stone-700">
            <h3 className="font-display text-lg text-[var(--charcoal)]">基地條件</h3>
            <p className="mt-2">
              北約 {site.north}m／南約 {site.south}m／西約 {site.west}m／東約 {site.east}m，
              近似梯形面積 {site.areaM2} m²（約 {sitePing} 坪）。
              本方案建蔽率 {coverageUsed}%（上限 60%）、容積率 {farUsed}%（上限 220%），法規餘裕充足，
              後續可依實際放樣微調外牆與陽台退縮。
            </p>
          </div>
        </aside>
      </section>

      <section className="mt-14">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl text-[var(--charcoal)]">實際感官示意</h2>
            <p className="mt-2 text-stone-600">外觀、鳥瞰與室內視角，對照約 32 坪基地的真實尺度感</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visuals.map((item, index) => (
            <motion.button
              key={item.id}
              type="button"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05, duration: 0.45 }}
              onClick={() => setLightbox(item.src)}
              className="group overflow-hidden border border-stone-300/70 bg-white/50 text-left"
            >
              <div className="aspect-[4/3] overflow-hidden">
                <img
                  src={item.src}
                  alt={item.title}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="p-4">
                <h3 className="font-display text-xl text-[var(--charcoal)]">{item.title}</h3>
                <p className="mt-1 text-sm text-stone-600">{item.caption}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      <section className="mt-14 border border-stone-300/70 bg-white/50 p-6 md:p-8">
        <h2 className="font-display text-2xl text-[var(--charcoal)]">規劃摘要</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="停車與彈性"
            body="西側臨路配置 1 個固定車位（約 2.6×5.5m），北側同寬帶為靈活空間，可作第二車位、機車／工作坊或枯山水庭。"
          />
          <SummaryCard
            title="居住格局"
            body="一樓以開放 LDK 為核心，北側和室可作客房或書房；二樓主臥＋兩間次臥，配合乾濕分離衛浴與陽台。"
          />
          <SummaryCard
            title="屋頂能源"
            body="切妻屋根大面鋪設太陽光電屋瓦，發電面積約對應屋頂投影，並維持深簷遮陽與日式水平線條。"
          />
        </div>
      </section>

      {lightbox && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setLightbox(null)}
          aria-label="關閉預覽"
        >
          <img
            src={lightbox}
            alt="放大預覽"
            className="max-h-[90vh] max-w-[95vw] object-contain shadow-2xl"
          />
        </button>
      )}
    </div>
  )
}

type RoomListProps = {
  title: string
  rooms: Array<{ id: string; name: string; areaM2: number; note?: string }>
}

function RoomList({ title, rooms }: RoomListProps) {
  return (
    <div className="border border-stone-300/70 bg-white/55 p-5">
      <h3 className="font-display text-lg text-[var(--charcoal)]">{title}</h3>
      <ul className="mt-3 divide-y divide-stone-200/80">
        {rooms.map((room) => (
          <li key={room.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span>
              {room.name}
              {room.note ? <span className="ml-2 text-xs text-stone-500">{room.note}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-stone-700">{room.areaM2.toFixed(1)} m²</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type SummaryCardProps = {
  title: string
  body: string
}

function SummaryCard({ title, body }: SummaryCardProps) {
  return (
    <div>
      <h3 className="font-display text-lg text-[var(--moss)]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-stone-700">{body}</p>
    </div>
  )
}

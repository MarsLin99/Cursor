import { useMemo, useState } from 'react'
import { formatMoney, formatNumber } from '../lib/format'
import {
  strategyCashPreview,
  strategyNeedsContracts,
} from '../lib/options'
import type { HedgeChoice, MarketEvent } from '../types'

type Props = {
  event: MarketEvent
  spotPrice: number
  onChoose: (choice: HedgeChoice, contracts: number) => void
}

const SEVERITY_LABEL: Record<MarketEvent['severity'], string> = {
  mild: '輕度衝擊',
  sharp: '急殺壓力',
  crash: '高風險事件',
  rally: '強勢行情',
  volatile: '高波動',
}

export function EventModal({ event, spotPrice, onChoose }: Props) {
  const [contracts, setContracts] = useState(1)
  const [selected, setSelected] = useState<HedgeChoice | null>(null)

  const preview = useMemo(() => {
    if (!selected) return null
    return strategyCashPreview(
      selected,
      spotPrice,
      event.severity,
      contracts,
    )
  }, [selected, spotPrice, event.severity, contracts])

  const needsQty =
    selected != null &&
    (strategyNeedsContracts(selected) || selected === 'add_long')

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card event-modal">
        <div className="event-kicker">
          <span className="pulse-dot" aria-hidden />
          突發事件・暫停走圖
        </div>
        <h2>{event.title}</h2>
        <p className="event-severity">{SEVERITY_LABEL[event.severity]}</p>
        <p className="event-copy">{event.narrative}</p>
        <p className="event-spot">
          當下現貨參考價 <strong>{formatNumber(spotPrice)}</strong>
        </p>

        <div className="event-choices">
          {event.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`choice-btn${selected === c.id ? ' selected' : ''}`}
              onClick={() => setSelected(c.id)}
            >
              <span className="choice-label">{c.label}</span>
              <span className="choice-hint">{c.hint}</span>
            </button>
          ))}
        </div>

        {needsQty && (
          <label className="contract-row">
            {selected === 'add_long' ? '加碼張數' : '選擇權口數'}
            <input
              type="number"
              min={1}
              max={50}
              value={contracts}
              onChange={(e) =>
                setContracts(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
            />
          </label>
        )}

        {preview && (
          <p className="event-preview">
            {preview.label}{' '}
            <strong className={preview.cashDelta >= 0 ? 'up' : 'down'}>
              {formatMoney(preview.cashDelta)}
            </strong>
            {selected === 'add_long' ? '（1 張 = 1,000 股）' : '（1 口 ≈ 1,000 股）'}
          </p>
        )}

        <p className="hint event-manual-hint">
          確認後不會自動走圖；請自行按下一根觀察，並在側欄自行平倉選擇權。
        </p>

        <button
          type="button"
          className="primary confirm-choice"
          disabled={!selected}
          onClick={() => selected && onChoose(selected, contracts)}
        >
          確認下單
        </button>
      </div>
    </div>
  )
}

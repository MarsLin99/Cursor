import type { HedgeChoice, MarketEvent } from '../types'

type Props = {
  event: MarketEvent
  spotPrice: number
  onChoose: (choice: HedgeChoice) => void
}

const SEVERITY_LABEL: Record<MarketEvent['severity'], string> = {
  mild: '輕度衝擊',
  sharp: '急殺壓力',
  crash: '高風險事件',
  rally: '強勢行情',
  volatile: '高波動',
}

export function EventModal({ event, spotPrice, onChoose }: Props) {
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
          當下現貨參考價 <strong>{spotPrice.toFixed(2)}</strong>
        </p>
        <div className="event-choices">
          {event.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className="choice-btn"
              onClick={() => onChoose(c.id)}
            >
              <span className="choice-label">{c.label}</span>
              <span className="choice-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

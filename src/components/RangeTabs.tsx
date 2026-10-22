import { RANGE_OPTIONS } from '../lib/range'
import type { RangeKey } from '../types'

type Props = {
  value: RangeKey
  onChange: (v: RangeKey) => void
}

export function RangeTabs({ value, onChange }: Props) {
  return (
    <div className="range-tabs" role="tablist" aria-label="趨勢週期">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="tab"
          aria-selected={value === opt.key}
          className={value === opt.key ? 'active' : ''}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

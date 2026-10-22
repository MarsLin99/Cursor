import { useMemo, useState } from 'react'
import { filterByRange, formatDate, formatNumber } from '../lib/range'
import type { IndicatorSeries, RangeKey } from '../types'
import { RangeTabs } from './RangeTabs'
import { TrendChart } from './TrendChart'

const ACCENTS: Record<string, string> = {
  ism: '#1F6F6A',
  sahm: '#C45C26',
  'business-signal': '#2F6B9A',
  'export-yoy': '#3D7A4A',
  bdi: '#0E4D6B',
}

type Props = {
  indicator: IndicatorSeries
  delay: number
}

export function IndicatorPanel({ indicator, delay }: Props) {
  const [range, setRange] = useState<RangeKey>('1y')
  const data = useMemo(
    () => filterByRange(indicator.series, range),
    [indicator.series, range],
  )

  const threshold =
    typeof indicator.meta?.threshold === 'number'
      ? indicator.meta.threshold
      : null

  const latestLabel =
    indicator.id === 'business-signal'
      ? String(indicator.meta?.signalName || indicator.latest?.label || '')
      : null

  const change = indicator.change
  const changeClass =
    change == null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  return (
    <article className="panel" style={{ animationDelay: `${delay}ms` }}>
      <header className="panel-head">
        <div>
          <h2>{indicator.title}</h2>
          <p className="panel-note">{indicator.note}</p>
        </div>
        <div className="panel-latest">
          {indicator.latest ? (
            <>
              <strong>
                {formatNumber(
                  indicator.latest.value,
                  indicator.id === 'sahm' ? 3 : 2,
                )}
                <span className="unit">{indicator.unit}</span>
              </strong>
              {latestLabel && <em className="signal-pill">{latestLabel}</em>}
              <span className={`change ${changeClass}`}>
                {change == null
                  ? '—'
                  : `${change > 0 ? '+' : ''}${formatNumber(
                      change,
                      indicator.id === 'sahm' ? 3 : 2,
                    )}`}
              </span>
              <small>{formatDate(indicator.latest.date)}</small>
            </>
          ) : (
            <strong className="muted">暫無資料</strong>
          )}
        </div>
      </header>

      <RangeTabs value={range} onChange={setRange} />
      <TrendChart
        data={data}
        unit={indicator.unit}
        threshold={threshold}
        accent={ACCENTS[indicator.id] || '#1F6F6A'}
      />
      <footer className="panel-foot">來源：{indicator.source}</footer>
    </article>
  )
}

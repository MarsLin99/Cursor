import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDate, formatNumber } from '../lib/range'
import type { SeriesPoint } from '../types'

type Props = {
  data: SeriesPoint[]
  unit: string
  threshold?: number | null
  accent?: string
}

export function TrendChart({
  data,
  unit,
  threshold = null,
  accent = '#1F6F6A',
}: Props) {
  if (!data.length) {
    return <div className="chart-empty">此週期尚無足夠資料點</div>
  }

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(15, 45, 55, 0.08)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v) =>
              new Date(v).toLocaleDateString('zh-TW', {
                month: 'numeric',
                day: 'numeric',
                timeZone: 'Asia/Taipei',
              })
            }
            minTickGap={28}
            tick={{ fill: '#5A6B72', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={48}
            tick={{ fill: '#5A6B72', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatNumber(Number(v), 1)}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: '1px solid rgba(15,45,55,0.08)',
              background: 'rgba(255,255,255,0.96)',
              boxShadow: '0 8px 24px rgba(11,31,42,0.08)',
            }}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value) => [
              `${formatNumber(Number(value), 2)} ${unit}`,
              '數值',
            ]}
          />
          {threshold != null && (
            <ReferenceLine
              y={threshold}
              stroke="#C45C26"
              strokeDasharray="4 4"
              label={{
                value: `臨界 ${threshold}`,
                fill: '#C45C26',
                fontSize: 11,
                position: 'insideTopRight',
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={accent}
            strokeWidth={2.4}
            dot={false}
            activeDot={{ r: 4, fill: accent }}
            animationDuration={700}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

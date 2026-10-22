import { formatDate, formatNumber } from '../lib/range'
import type { StockSummary } from '../types'

type Props = {
  stock: StockSummary | null
}

function yi(n: number): string {
  if (Math.abs(n) >= 1e8) return `${formatNumber(n / 1e8, 2)} 億`
  if (Math.abs(n) >= 1e4) return `${formatNumber(n / 1e4, 2)} 萬`
  return formatNumber(n, 0)
}

export function StockPanel({ stock }: Props) {
  if (!stock) {
    return (
      <section className="stock-panel empty">
        <h2>前一日台股資訊總結</h2>
        <p>目前無法取得證交所資料，請稍後再試。</p>
      </section>
    )
  }

  const cls = stock.change > 0 ? 'up' : stock.change < 0 ? 'down' : 'flat'

  return (
    <section className="stock-panel">
      <div className="stock-copy">
        <p className="eyebrow">台股收盤</p>
        <h2>前一日台股資訊總結</h2>
        <p className="stock-date">{formatDate(stock.date)}</p>
        <p className="stock-note">{stock.note}</p>
      </div>
      <div className="stock-metrics">
        <div>
          <span>加權指數</span>
          <strong>{formatNumber(stock.index, 2)}</strong>
        </div>
        <div>
          <span>漲跌</span>
          <strong className={cls}>
            {stock.change > 0 ? '+' : ''}
            {formatNumber(stock.change, 2)}
            {stock.changePercent != null && (
              <small>
                （{stock.changePercent > 0 ? '+' : ''}
                {formatNumber(stock.changePercent, 2)}%）
              </small>
            )}
          </strong>
        </div>
        <div>
          <span>成交金額</span>
          <strong>{yi(stock.turnoverTwd)} 元</strong>
        </div>
        <div>
          <span>成交股數</span>
          <strong>{yi(stock.volumeShares)} 股</strong>
        </div>
        <div>
          <span>成交筆數</span>
          <strong>{formatNumber(stock.trades, 0)}</strong>
        </div>
      </div>
      <p className="stock-source">來源：{stock.source}</p>
    </section>
  )
}

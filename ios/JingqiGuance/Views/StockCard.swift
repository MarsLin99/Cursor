import SwiftUI

struct StockCard: View {
    let stock: StockSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("台股收盤")
                .font(.caption.weight(.semibold))
                .opacity(0.8)
            Text("前一日台股資訊總結")
                .font(.title2.weight(.bold))

            if let stock {
                Text(formatDate(stock.date))
                    .font(.subheadline)
                    .opacity(0.85)
                Text(stock.note)
                    .font(.subheadline)
                    .opacity(0.9)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    metric("加權指數", format(stock.index))
                    metric(
                        "漲跌",
                        "\(signed(stock.change))"
                            + (stock.changePercent.map { "（\(signed($0))%）" } ?? "")
                    )
                    metric("成交金額", yi(stock.turnoverTwd) + " 元")
                    metric("成交股數", yi(stock.volumeShares) + " 股")
                    metric("成交筆數", format(stock.trades, fraction: 0))
                }
                Text("來源：\(stock.source)")
                    .font(.caption2)
                    .opacity(0.75)
            } else {
                Text("目前無法取得證交所資料，下拉或點右上角更新。")
                    .font(.subheadline)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(Color.white)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.30, blue: 0.42),
                    Color(red: 0.12, green: 0.44, blue: 0.42),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous)
        )
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).opacity(0.75)
            Text(value).font(.headline.monospacedDigit())
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
}

private func format(_ n: Double, fraction: Int = 2) -> String {
    n.formatted(.number.precision(.fractionLength(0...fraction)))
}

private func signed(_ n: Double) -> String {
    let body = format(abs(n))
    if n > 0 { return "+\(body)" }
    if n < 0 { return "-\(body)" }
    return body
}

private func yi(_ n: Double) -> String {
    if abs(n) >= 1e8 { return format(n / 1e8) + " 億" }
    if abs(n) >= 1e4 { return format(n / 1e4) + " 萬" }
    return format(n, fraction: 0)
}

private func formatDate(_ iso: String) -> String {
    let parser = DateFormatter()
    parser.calendar = Calendar(identifier: .gregorian)
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.dateFormat = "yyyy-MM-dd"
    guard let date = parser.date(from: String(iso.prefix(10))) else { return iso }
    return date.formatted(date: .abbreviated, time: .omitted)
}

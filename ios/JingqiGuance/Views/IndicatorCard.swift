import Charts
import SwiftUI

struct IndicatorCard: View {
    let indicator: IndicatorSeries
    @State private var range: ChartRange = .oneYear

    private var filtered: [SeriesPoint] {
        guard let last = indicator.series.last,
              let lastDate = parse(last.date)
        else { return indicator.series }
        let minDate = Calendar.current.date(byAdding: .day, value: -range.days, to: lastDate) ?? lastDate
        let points = indicator.series.filter { point in
            guard let d = parse(point.date) else { return false }
            return d >= minDate
        }
        if points.count < 2, indicator.series.count >= 2 {
            let keep = range == .oneMonth ? 3 : 6
            return Array(indicator.series.suffix(min(indicator.series.count, keep)))
        }
        return points
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(indicator.title)
                        .font(.title3.weight(.bold))
                    Text(indicator.note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    if let latest = indicator.latest {
                        Text("\(format(latest.value, digits: indicator.id == "sahm" ? 3 : 2)) \(indicator.unit)")
                            .font(.title3.monospacedDigit().weight(.semibold))
                        if let signal = indicator.signalName {
                            Text(signal)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.blue.opacity(0.12), in: Capsule())
                        }
                        Text(changeText)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(changeColor)
                        Text(formatDate(latest.date))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("暫無資料")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Picker("週期", selection: $range) {
                ForEach(ChartRange.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)

            if filtered.isEmpty {
                Text("此週期尚無足夠資料點")
                    .frame(height: 180)
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(.secondary)
            } else {
                Chart {
                    ForEach(filtered) { point in
                        LineMark(
                            x: .value("日期", parse(point.date) ?? Date()),
                            y: .value(indicator.unit, point.value)
                        )
                        .interpolationMethod(.catmullRom)
                        .foregroundStyle(accent)
                    }
                    if let threshold = indicator.threshold {
                        RuleMark(y: .value("臨界", threshold))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            .foregroundStyle(Color(red: 0.77, green: 0.36, blue: 0.15))
                            .annotation(position: .top, alignment: .trailing) {
                                Text("臨界 \(format(threshold, digits: 1))")
                                    .font(.caption2)
                                    .foregroundStyle(Color(red: 0.77, green: 0.36, blue: 0.15))
                            }
                    }
                }
                .frame(height: 200)
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4))
                }
            }

            Text("來源：\(indicator.source)")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.black.opacity(0.06), lineWidth: 1)
        )
    }

    private var accent: Color {
        switch indicator.id {
        case "ism": return Color(red: 0.12, green: 0.44, blue: 0.42)
        case "sahm": return Color(red: 0.77, green: 0.36, blue: 0.15)
        case "business-signal": return Color(red: 0.18, green: 0.42, blue: 0.60)
        case "export-yoy": return Color(red: 0.24, green: 0.48, blue: 0.29)
        case "bdi": return Color(red: 0.05, green: 0.30, blue: 0.42)
        default: return .teal
        }
    }

    private var changeText: String {
        guard let change = indicator.change else { return "—" }
        let digits = indicator.id == "sahm" ? 3 : 2
        let body = format(abs(change), digits: digits)
        if change > 0 { return "+\(body)" }
        if change < 0 { return "-\(body)" }
        return body
    }

    private var changeColor: Color {
        guard let change = indicator.change else { return .secondary }
        if change > 0 { return Color(red: 0.12, green: 0.48, blue: 0.30) }
        if change < 0 { return Color(red: 0.71, green: 0.14, blue: 0.09) }
        return .secondary
    }
}

private func parse(_ iso: String) -> Date? {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Taipei")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.date(from: String(iso.prefix(10)))
}

private func format(_ n: Double, digits: Int) -> String {
    n.formatted(.number.precision(.fractionLength(0...digits)))
}

private func formatDate(_ iso: String) -> String {
    guard let date = parse(iso) else { return iso }
    return date.formatted(date: .abbreviated, time: .omitted)
}

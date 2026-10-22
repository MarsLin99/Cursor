import Foundation

struct SeriesPoint: Identifiable, Hashable {
    var id: String { date }
    let date: String
    let value: Double
    var label: String? = nil
}

struct IndicatorSeries: Identifiable {
    let id: String
    let title: String
    let unit: String
    let frequency: Frequency
    var latest: SeriesPoint?
    var change: Double?
    var note: String
    var source: String
    var series: [SeriesPoint]
    var threshold: Double? = nil
    var signalName: String? = nil

    enum Frequency {
        case daily
        case monthly
    }
}

struct StockSummary {
    let date: String
    let index: Double
    let change: Double
    let changePercent: Double?
    let volumeShares: Double
    let turnoverTwd: Double
    let trades: Double
    let source: String
    let note: String
}

enum ChartRange: String, CaseIterable, Identifiable {
    case oneYear = "一年"
    case sixMonths = "半年"
    case threeMonths = "三個月"
    case oneMonth = "一個月"

    var id: String { rawValue }

    var days: Int {
        switch self {
        case .oneYear: return 365
        case .sixMonths: return 182
        case .threeMonths: return 92
        case .oneMonth: return 31
        }
    }
}

enum LoadState {
    case idle
    case loading
    case loaded
    case failed(String)
}

import Combine
import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var indicators: [IndicatorSeries] = []
    @Published var stock: StockSummary?
    @Published var state: LoadState = .idle
    @Published var updatedAt: Date?

    func load(force _: Bool = false) async {
        state = .loading

        async let ism = soft("ism", "美國 ISM 製造業指數") {
            try await IndicatorServices.fetchISM()
        }
        async let sahm = soft("sahm", "薩姆規則衰退指標") {
            try await IndicatorServices.fetchSahm()
        }
        async let signal = soft("business-signal", "景氣燈號") {
            try await IndicatorServices.fetchBusinessSignal()
        }
        async let exp = soft("export-yoy", "台灣出口年增率") {
            try await IndicatorServices.fetchExportYoy()
        }
        async let bdi = soft("bdi", "波羅的海乾散貨指數（BDI）") {
            try await IndicatorServices.fetchBDI()
        }
        async let stockResult: StockSummary? = {
            try? await IndicatorServices.fetchStock()
        }()

        indicators = await [ism, sahm, signal, exp, bdi]
        stock = await stockResult
        updatedAt = Date()
        state = .loaded
    }

    private func soft(
        _ id: String,
        _ title: String,
        _ work: () async throws -> IndicatorSeries
    ) async -> IndicatorSeries {
        do {
            return try await work()
        } catch {
            return IndicatorSeries(
                id: id,
                title: title,
                unit: "",
                frequency: id == "bdi" ? .daily : .monthly,
                latest: nil,
                change: nil,
                note: error.localizedDescription,
                source: "取得失敗",
                series: []
            )
        }
    }
}

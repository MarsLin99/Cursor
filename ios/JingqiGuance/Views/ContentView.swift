import SwiftUI

struct ContentView: View {
    @StateObject private var model = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    hero
                    if case .failed(let message) = model.state {
                        Text("載入失敗：\(message)")
                            .foregroundStyle(.red)
                            .padding()
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    }
                    StockCard(stock: model.stock)
                    ForEach(model.indicators) { indicator in
                        IndicatorCard(indicator: indicator)
                    }
                    Text("僅供個人觀察，非投資建議。免費 Apple ID 簽名約每 7 天需用 Mac 重新安裝一次。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 24)
                }
                .padding(.horizontal, 16)
            }
            .background(atmosphere)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.load(force: true) }
                    } label: {
                        if case .loading = model.state {
                            ProgressView()
                        } else {
                            Label("更新", systemImage: "arrow.clockwise")
                        }
                    }
                }
            }
            .task {
                if model.indicators.isEmpty {
                    await model.load()
                }
            }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("景氣觀測")
                .font(.system(size: 40, weight: .bold, design: .serif))
                .foregroundStyle(Color(red: 0.05, green: 0.30, blue: 0.42))
            Text("把關鍵景氣訊號，收成隨身儀表板。")
                .font(.title3.weight(.semibold))
            Text("ISM、薩姆規則、景氣燈號、出口年增、BDI 與台股總結。可切換一年到一個月趨勢。")
                .font(.body)
                .foregroundStyle(.secondary)
            if let updatedAt = model.updatedAt {
                Text("更新於 \(updatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 12)
    }

    private var atmosphere: some View {
        LinearGradient(
            colors: [
                Color(red: 0.91, green: 0.95, blue: 0.96),
                Color(red: 0.84, green: 0.91, blue: 0.93),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

#Preview {
    ContentView()
}

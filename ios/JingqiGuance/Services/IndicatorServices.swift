import Foundation

enum IndicatorServices {
    private static let ndcZipURL =
        "https://ws.ndc.gov.tw/Download.ashx?u=LzAwMS9hZG1pbmlzdHJhdG9yLzEwL3JlbGZpbGUvNTc4MS82MzkyL2VhMjM1YmQ5LWQwNTItNGE2OS1hYmZjLWQ1Yzc4NWQzZDBlMi56aXA%3d&n=5pmv5rCj5oyH5qiZ5Y%2bK54eI6JmfLnppcA%3d%3d&icon=.zip"

    private static let signalNames: [String: String] = [
        "藍": "藍燈（低迷）",
        "黃藍": "黃藍燈（轉向）",
        "綠": "綠燈（穩定）",
        "黃紅": "黃紅燈（轉向）",
        "紅": "紅燈（熱絡）",
    ]

    // MARK: - ISM

    static func fetchISM() async throws -> IndicatorSeries {
        async let historical = loadPMIBundle("pmi-historical")
        async let wayback = loadPMIBundle("pmi-wayback")
        async let curated = loadPMIBundle("pmi-curated")
        async let live = scrapePRNewswire()

        let merged = mergePoints(try await historical + wayback + curated + live)
        let latest = merged.last
        let prev = merged.dropLast().last
        let change = (latest != nil && prev != nil) ? latest!.value - prev!.value : nil

        return IndicatorSeries(
            id: "ism",
            title: "美國 ISM 製造業指數",
            unit: "指數",
            frequency: .monthly,
            latest: latest,
            change: change.map { ($0 * 10).rounded() / 10 },
            note: "50 為榮枯線；>50 擴張、＜50 緊縮",
            source: "ISM Report on Business（公開歷史 / PR Newswire）",
            series: merged,
            threshold: 50
        )
    }

    private struct PMIBundle: Decodable {
        struct Obs: Decodable {
            let date: String
            let value: Double
        }
        let observations: [Obs]
    }

    private static func loadPMIBundle(_ name: String) async throws -> [SeriesPoint] {
        let url =
            "https://raw.githubusercontent.com/RealMaxPower/bellwether/main/data/\(name).json"
        let bundle: PMIBundle = try await HTTPClient.json(from: url)
        return bundle.observations.map {
            SeriesPoint(date: String($0.date.prefix(10)), value: $0.value)
        }
    }

    private static func scrapePRNewswire() async -> [SeriesPoint] {
        let months: [String: Int] = [
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12,
        ]
        do {
            let html = try await HTTPClient.text(
                from: "https://www.prnewswire.com/search/news/?keyword=ISM%20Manufacturing%20PMI&page=1&pagesize=20"
            )
            let pattern =
                #"Manufacturing PMI[^%]{0,30}?at\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*;\s*([A-Za-z]+)\s+(\d{4})"#
            let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            let range = NSRange(html.startIndex..<html.endIndex, in: html)
            var seen = Set<String>()
            var points: [SeriesPoint] = []
            regex.enumerateMatches(in: html, options: [], range: range) { match, _, _ in
                guard let match,
                      let vRange = Range(match.range(at: 1), in: html),
                      let mRange = Range(match.range(at: 2), in: html),
                      let yRange = Range(match.range(at: 3), in: html),
                      let value = Double(html[vRange]),
                      let month = months[html[mRange].lowercased()],
                      let year = Int(html[yRange])
                else { return }
                let date = String(format: "%04d-%02d-01", year, month)
                guard seen.insert(date).inserted else { return }
                points.append(SeriesPoint(date: date, value: value))
            }
            return points
        } catch {
            return []
        }
    }

    // MARK: - Sahm

    static func fetchSahm() async throws -> IndicatorSeries {
        let year = Calendar.current.component(.year, from: Date())
        let body: [String: Any] = [
            "seriesid": ["LNS14000000"],
            "startyear": "\(year - 5)",
            "endyear": "\(year)",
        ]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        var request = URLRequest(
            url: URL(string: "https://api.bls.gov/publicAPI/v2/timeseries/data/")!
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let results = json?["Results"] as? [String: Any],
              let seriesArr = results["series"] as? [[String: Any]],
              let first = seriesArr.first,
              let rows = first["data"] as? [[String: Any]]
        else {
            throw URLError(.cannotParseResponse)
        }

        let unemp: [SeriesPoint] = rows.compactMap { row in
            guard let period = row["period"] as? String,
                  period.hasPrefix("M"),
                  let year = row["year"] as? String,
                  let valueStr = row["value"] as? String,
                  valueStr != "-",
                  let value = Double(valueStr)
            else { return nil }
            let month = period.dropFirst()
            return SeriesPoint(date: "\(year)-\(month)-01", value: value)
        }
        .sorted { $0.date < $1.date }

        let series = computeSahm(unemp)
        let latest = series.last
        let prev = series.dropLast().last
        let change = (latest != nil && prev != nil) ? latest!.value - prev!.value : nil

        return IndicatorSeries(
            id: "sahm",
            title: "薩姆規則衰退指標",
            unit: "百分點",
            frequency: .monthly,
            latest: latest,
            change: change.map { ($0 * 1000).rounded() / 1000 },
            note: "≥ 0.5 視為觸發衰退訊號（即時版，以 BLS 失業率推算）",
            source: "美國勞工統計局 BLS",
            series: series,
            threshold: 0.5
        )
    }

    private static func computeSahm(_ unemp: [SeriesPoint]) -> [SeriesPoint] {
        let values = unemp.map(\.value)
        let dates = unemp.map(\.date)
        var ma3: [Double?] = Array(repeating: nil, count: values.count)
        for i in values.indices where i >= 2 {
            ma3[i] = (values[i - 2] + values[i - 1] + values[i]) / 3
        }
        var out: [SeriesPoint] = []
        for i in ma3.indices {
            guard let current = ma3[i] else { continue }
            let window = ma3[max(0, i - 12)..<i].compactMap { $0 }
            guard let trough = window.min() else { continue }
            out.append(
                SeriesPoint(date: dates[i], value: ((current - trough) * 1000).rounded() / 1000)
            )
        }
        return out
    }

    // MARK: - NDC

    private static var ndcZipCache: Data?

    private static func ndcCSV(_ fileName: String) async throws -> [[String]] {
        let zipData: Data
        if let cached = ndcZipCache {
            zipData = cached
        } else {
            zipData = try await HTTPClient.data(from: ndcZipURL)
            ndcZipCache = zipData
        }
        let csvData = try ZipReader.fileData(named: fileName, in: zipData)
        let text = String(data: csvData, encoding: .utf8)
            ?? String(data: csvData, encoding: .utf16)
            ?? ""
        return CSV.parse(text)
    }

    private static func yyyymmToDate(_ yyyymm: String) -> String {
        let y = yyyymm.prefix(4)
        let m = yyyymm.suffix(2)
        return "\(y)-\(m)-01"
    }

    static func fetchBusinessSignal() async throws -> IndicatorSeries {
        let rows = try await ndcCSV("景氣指標與燈號.csv")
        guard let header = rows.first,
              let dateIdx = header.firstIndex(of: "Date"),
              let scoreIdx = header.firstIndex(of: "景氣對策信號綜合分數"),
              let signalIdx = header.firstIndex(of: "景氣對策信號")
        else { throw URLError(.cannotParseResponse) }

        var series: [SeriesPoint] = []
        for row in rows.dropFirst() {
            guard row.count > max(dateIdx, scoreIdx, signalIdx) else { continue }
            let score = row[scoreIdx]
            guard score != "-", let value = Double(score) else { continue }
            series.append(
                SeriesPoint(
                    date: yyyymmToDate(row[dateIdx]),
                    value: value,
                    label: row[signalIdx]
                )
            )
        }

        let latest = series.last
        let prev = series.dropLast().last
        let change = (latest != nil && prev != nil) ? latest!.value - prev!.value : nil
        let signalName = latest.flatMap { signalNames[$0.label ?? ""] ?? $0.label }

        return IndicatorSeries(
            id: "business-signal",
            title: "景氣燈號",
            unit: "綜合分數",
            frequency: .monthly,
            latest: latest,
            change: change,
            note: "藍≤22、黃藍23–31、綠32–37、黃紅38–44、紅≥45",
            source: "國發會景氣指標及燈號",
            series: series,
            signalName: signalName
        )
    }

    static func fetchExportYoy() async throws -> IndicatorSeries {
        let rows = try await ndcCSV("景氣對策信號構成項目.csv")
        guard let header = rows.first,
              let dateIdx = header.firstIndex(of: "Date"),
              let exportIdx = header.firstIndex(of: "海關出口值(十億元)")
        else { throw URLError(.cannotParseResponse) }

        var levels: [SeriesPoint] = []
        for row in rows.dropFirst() {
            guard row.count > max(dateIdx, exportIdx) else { continue }
            let raw = row[exportIdx]
            guard raw != "-", let value = Double(raw) else { continue }
            levels.append(SeriesPoint(date: yyyymmToDate(row[dateIdx]), value: value))
        }
        let byDate = Dictionary(uniqueKeysWithValues: levels.map { ($0.date, $0.value) })
        var series: [SeriesPoint] = []
        for p in levels {
            let parts = p.date.split(separator: "-")
            guard parts.count >= 2, let y = Int(parts[0]) else { continue }
            let prevKey = "\(y - 1)-\(parts[1])-01"
            guard let base = byDate[prevKey], base != 0 else { continue }
            let yoy = ((p.value / base) - 1) * 100
            series.append(SeriesPoint(date: p.date, value: (yoy * 100).rounded() / 100))
        }

        let latest = series.last
        let prev = series.dropLast().last
        let change = (latest != nil && prev != nil) ? latest!.value - prev!.value : nil

        return IndicatorSeries(
            id: "export-yoy",
            title: "台灣出口年增率",
            unit: "%",
            frequency: .monthly,
            latest: latest,
            change: change.map { ($0 * 100).rounded() / 100 },
            note: "以國發會公布之海關出口值計算同比年增率",
            source: "國發會景氣對策信號構成項目",
            series: series
        )
    }

    // MARK: - BDI

    static func fetchBDI() async throws -> IndicatorSeries {
        let text = try await HTTPClient.text(
            from: "https://histock.tw/stock/module/stockdata.aspx?no=BDI&m=DayK",
            headers: [
                "Referer": "https://histock.tw/index/BDI",
                "X-Requested-With": "XMLHttpRequest",
            ]
        )
        guard let dataObj = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let raw = (dataObj["Data"] as? String) ?? (dataObj["data"] as? String)
        else { throw URLError(.cannotParseResponse) }

        let cleaned = raw
            .replacingOccurrences(of: ",]", with: "]")
            .replacingOccurrences(of: ",}", with: "}")
        guard let rows = try JSONSerialization.jsonObject(with: Data(cleaned.utf8)) as? [[Double]]
        else { throw URLError(.cannotParseResponse) }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Taipei")
        formatter.dateFormat = "yyyy-MM-dd"
        let series: [SeriesPoint] = rows.compactMap { row in
            guard row.count >= 2 else { return nil }
            let ts = row[0] / 1000
            let close = row.count > 4 ? row[4] : row[1]
            let date = formatter.string(from: Date(timeIntervalSince1970: ts))
            return SeriesPoint(date: date, value: close)
        }
        .sorted { $0.date < $1.date }

        let latest = series.last
        let prev = series.dropLast().last
        let change = (latest != nil && prev != nil) ? latest!.value - prev!.value : nil

        return IndicatorSeries(
            id: "bdi",
            title: "波羅的海乾散貨指數（BDI）",
            unit: "指數",
            frequency: .daily,
            latest: latest,
            change: change.map { ($0 * 100).rounded() / 100 },
            note: "全球乾散貨航運運價綜合指標",
            source: "HiStock（BDI 日線）",
            series: series
        )
    }

    // MARK: - TWSE

    static func fetchStock() async throws -> StockSummary {
        let cal = Calendar(identifier: .gregorian)
        var best: [String]?
        for i in 0..<4 {
            guard let monthDate = cal.date(byAdding: .month, value: -i, to: Date()) else { continue }
            let y = cal.component(.year, from: monthDate)
            let m = cal.component(.month, from: monthDate)
            let dateParam = String(format: "%04d%02d01", y, m)
            let url =
                "https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=\(dateParam)"
            guard let obj = try JSONSerialization.jsonObject(
                with: try await HTTPClient.data(from: url)
            ) as? [String: Any],
                  obj["stat"] as? String == "OK",
                  let rows = obj["data"] as? [[String]],
                  let last = rows.last
            else { continue }
            if best == nil || rocToIso(last[0]) > rocToIso(best![0]) {
                best = last
            }
        }
        guard let row = best else { throw URLError(.cannotParseResponse) }
        let index = num(row[4])
        let change = num(row[5])
        let prev = index - change
        let pct = prev == 0 ? nil : ((change / prev) * 1000).rounded() / 10
        let sign = change > 0 ? "+" : ""
        let pctText = pct.map { " / \(sign)\(String(format: "%.2f", $0))%" } ?? ""

        return StockSummary(
            date: rocToIso(row[0]),
            index: index,
            change: change,
            changePercent: pct,
            volumeShares: num(row[1]),
            turnoverTwd: num(row[2]),
            trades: num(row[3]),
            source: "臺灣證券交易所 TWSE",
            note:
                "加權指數收盤 \(format(index))（\(sign)\(format(change))\(pctText)）"
        )
    }

    private static func rocToIso(_ roc: String) -> String {
        let parts = roc.split(separator: "/").map(String.init)
        guard parts.count == 3, let y = Int(parts[0]) else { return roc }
        return String(format: "%04d-%02d-%02d", y + 1911, Int(parts[1]) ?? 1, Int(parts[2]) ?? 1)
    }

    private static func num(_ s: String) -> Double {
        Double(s.replacingOccurrences(of: ",", with: "")) ?? 0
    }

    private static func format(_ n: Double) -> String {
        n.formatted(.number.precision(.fractionLength(0...2)))
    }

    private static func mergePoints(_ points: [SeriesPoint]) -> [SeriesPoint] {
        var map: [String: Double] = [:]
        for p in points { map[p.date] = p.value }
        return map.keys.sorted().map { SeriesPoint(date: $0, value: map[$0]!) }
    }
}

import Foundation

enum CSV {
    static func parse(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var cell = ""
        var inQuotes = false
        let chars = Array(text.trimmingCharacters(in: .init(charactersIn: "\u{FEFF}")))

        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if inQuotes {
                if ch == "\"" {
                    if i + 1 < chars.count, chars[i + 1] == "\"" {
                        cell.append("\"")
                        i += 1
                    } else {
                        inQuotes = false
                    }
                } else {
                    cell.append(ch)
                }
            } else if ch == "\"" {
                inQuotes = true
            } else if ch == "," {
                row.append(cell)
                cell = ""
            } else if ch == "\n" {
                row.append(cell)
                if row.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
                    rows.append(row)
                }
                row = []
                cell = ""
            } else if ch != "\r" {
                cell.append(ch)
            }
            i += 1
        }
        if !cell.isEmpty || !row.isEmpty {
            row.append(cell)
            rows.append(row)
        }
        return rows
    }
}

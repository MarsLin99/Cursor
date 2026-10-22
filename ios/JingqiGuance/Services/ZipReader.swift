import Foundation
import ZIPFoundation

enum ZipReader {
    static func fileData(named fileName: String, in zipData: Data) throws -> Data {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("ndc-\(UUID().uuidString).zip")
        try zipData.write(to: temp)
        defer { try? FileManager.default.removeItem(at: temp) }

        guard let archive = Archive(url: temp, accessMode: .read) else {
            throw ZipError.invalidArchive
        }
        guard let entry = archive[fileName] else {
            throw ZipError.fileNotFound(fileName)
        }
        var output = Data()
        _ = try archive.extract(entry, consumer: { chunk in
            output.append(chunk)
        })
        return output
    }

    enum ZipError: LocalizedError {
        case fileNotFound(String)
        case invalidArchive

        var errorDescription: String? {
            switch self {
            case .fileNotFound(let name): return "ZIP 找不到 \(name)"
            case .invalidArchive: return "ZIP 格式無效"
            }
        }
    }
}

import Foundation

enum HTTPClient {
    static func data(from urlString: String, headers: [String: String] = [:]) async throws -> Data {
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) JingqiGuance/1.0",
            forHTTPHeaderField: "User-Agent"
        )
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return data
    }

    static func text(from urlString: String, headers: [String: String] = [:]) async throws -> String {
        let data = try await data(from: urlString, headers: headers)
        return String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .utf16)
            ?? ""
    }

    static func json<T: Decodable>(from urlString: String, headers: [String: String] = [:]) async throws -> T {
        let data = try await data(from: urlString, headers: headers)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

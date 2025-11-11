import Foundation

#if DEBUG
public let API_BASE = URL(string: "http://127.0.0.1:8000")!
#else
public let API_BASE = URL(string: "https://your-prod-host")!
#endif

final class APIClient {
    static let shared = APIClient()
    private let urlSession: URLSession

    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 300
        urlSession = URLSession(configuration: cfg)
    }

    // MARK: - Helpers
    private func makeRequest(path: String, method: String = "GET", token: String? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: API_BASE) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func makeRequest<T: Encodable>(path: String, method: String = "GET", token: String? = nil, body: T) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: API_BASE) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONEncoder().encode(body)
        return req
    }

    private func send<Out: Decodable>(_ req: URLRequest) async throws -> Out {
        let (data, resp) = try await urlSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.custom("No HTTP response") }

        // Friendly message for wrong creds / unauthorized
        if http.statusCode == 401 || http.statusCode == 403 {
            throw APIError.custom("Invalid username or password.\n\nTo reset your password please use the PC.")
        }

        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
        do { return try JSONDecoder().decode(Out.self, from: data) }
        catch { throw APIError.decodeFailed }
    }

    // MARK: - Auth
    func login(username: String, password: String) async throws -> LoginResponse {
        let req = try makeRequest(path: "/login", method: "POST",
                                  body: LoginRequest(username: username, password: password))
        return try await send(req)
    }

    func register(username: String, password: String, resetWord: String?) async throws {
        let req = try makeRequest(path: "/register", method: "POST",
                                  body: RegisterRequest(username: username, password: password, reset_word: resetWord))
        struct Ok: Decodable {}
        let _: Ok = try await send(req)
    }

    func me(token: String) async throws -> MeResponse {
        let req = try makeRequest(path: "/me", token: token)
        return try await send(req)
    }

    // MARK: - Videos
    func startDownload(youtubeURL: String, token: String) async throws -> DownloadStartResponse {
        let req = try makeRequest(path: "/download", method: "POST", token: token,
                                  body: VideoRequest(url: youtubeURL))
        return try await send(req)
    }

    func checkStatus(fileId: String, token: String) async throws -> Bool {
        let req = try makeRequest(path: "/status/\(fileId)", token: token)
        let out: StatusResponse = try await send(req)
        return out.ready
    }

    func myDownloads(token: String) async throws -> [VideoItem] {
        let req = try makeRequest(path: "/my_downloads", token: token)
        return try await send(req)
    }

    func delete(fileId: String, token: String) async throws {
        let req = try makeRequest(path: "/delete/\(fileId)", method: "DELETE", token: token)
        struct Ok: Decodable {}
        let _: Ok = try await send(req)
    }

    // MARK: - File download
    func downloadURL(fileId: String, token: String) -> URL {
        let tokenQS = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
        return URL(string: "\(API_BASE)/download/\(fileId)?token=\(tokenQS)")!
    }

    @discardableResult
    func downloadFile(fileId: String, token: String) async throws -> (localURL: URL, suggestedName: String) {
        let req = URLRequest(url: downloadURL(fileId: fileId, token: token))
        let (data, resp) = try await urlSession.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }

        // best-effort filename
        let filename: String = {
            guard let disp = http.value(forHTTPHeaderField: "Content-Disposition") else { return "\(fileId).mp3" }
            if let r = disp.range(of: "filename*=") {
                let part = disp[r.upperBound...]
                if let a1 = part.firstIndex(of: "'"),
                   let a2 = part[part.index(after: a1)...].firstIndex(of: "'") {
                    let enc = String(part[part.index(after: a2)...]).trimmingCharacters(in: .whitespacesAndNewlines)
                    return enc.removingPercentEncoding ?? enc
                }
            }
            if let r = disp.range(of: "filename=") {
                var raw = String(disp[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                raw = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\";"))
                if !raw.isEmpty { return raw }
            }
            return "\(fileId).mp3"
        }()

        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: tmp)
        try data.write(to: tmp, options: .atomic)
        return (tmp, filename)
    }
}

import Foundation

enum APIError: Error, LocalizedError {
    case badURL
    case badStatus(Int)
    case decodeFailed
    case missingToken
    case custom(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad URL"
        case .badStatus(let c): return "Server returned status \(c)"
        case .decodeFailed: return "Could not decode response"
        case .missingToken: return "Missing auth token"
        case .custom(let s): return s
        }
    }
}

struct LoginRequest: Encodable { let username: String; let password: String }
struct RegisterRequest: Encodable { let username: String; let password: String; let reset_word: String? }

struct LoginResponse: Decodable { let token: String; let user: String; let is_admin: Bool }
struct MeResponse: Decodable { let user: String; let is_admin: Bool }

struct VideoRequest: Encodable { let url: String }
struct StatusResponse: Decodable { let ready: Bool }
struct DownloadStartResponse: Decodable { let file_id: String; let filename: String }

struct VideoItem: Decodable, Identifiable {
    let id: String
    let status: String
    let filename: String?
    let owner_username: String?
    let timestamp: String?

    private enum CodingKeys: String, CodingKey {
        case id, status, filename, owner_username, timestamp
        case file_id, owner, ts, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // id (fallback to file_id)
        if let v = try c.decodeIfPresent(String.self, forKey: .id) {
            id = v
        } else {
            id = try c.decode(String.self, forKey: .file_id)
        }

        status   = (try c.decodeIfPresent(String.self, forKey: .status)) ?? "unknown"
        filename = try c.decodeIfPresent(String.self, forKey: .filename)

        // owner_username (fallback to owner)
        if let owner = try c.decodeIfPresent(String.self, forKey: .owner_username) {
            owner_username = owner
        } else {
            owner_username = try c.decodeIfPresent(String.self, forKey: .owner)
        }

        // timestamp (fallbacks: ts, created_at)
        if let ts = try c.decodeIfPresent(String.self, forKey: .timestamp) {
            timestamp = ts
        } else if let ts = try c.decodeIfPresent(String.self, forKey: .ts) {
            timestamp = ts
        } else {
            timestamp = try c.decodeIfPresent(String.self, forKey: .created_at)
        }
    }
}

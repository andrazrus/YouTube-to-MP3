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

// For downloads grid
struct VideoItem: Decodable, Identifiable {
    let id: String
    let status: String
    let filename: String?
    let owner_username: String?
    let timestamp: String
}


import Foundation

struct ActivityEvent: Codable, Equatable {
    let timestamp: String
    let type: String
    let app: String?
    let title: String?
    let durationSec: Int
    let metadata: [String: String]?

    enum CodingKeys: String, CodingKey {
        case timestamp, type, app, title, durationSec, metadata
    }
}

struct EventsBatch: Codable {
    let events: [ActivityEvent]
}

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct UserInfo: Codable, Equatable {
    let id: String
    let email: String
    let fullName: String?
}

struct LoginResponse: Codable {
    let token: String
    let user: UserInfo
}

struct EventsResponse: Codable {
    let accepted: Int
    let ids: [String]?
    let storage: String?
}

struct APIErrorResponse: Codable {
    let error: String
}

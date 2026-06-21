import Foundation

enum APIClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(status: Int, message: String)
    case decodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL."
        case .invalidResponse:
            return "Unexpected server response."
        case .httpError(_, let message):
            return message
        case .decodingFailed:
            return "Could not decode server response."
        }
    }
}

final class APIClient {
    var baseURL: URL

    init(baseURL: URL = URL(string: "http://127.0.0.1:4000")!) {
        self.baseURL = baseURL
    }

    func login(email: String, password: String) async throws -> LoginResponse {
        let body = LoginRequest(email: email, password: password)
        return try await request(
            path: "/api/auth/login",
            method: "POST",
            body: body,
            token: nil
        )
    }

    func postEvents(_ events: [ActivityEvent], token: String) async throws -> EventsResponse {
        let body = EventsBatch(events: events)
        return try await request(
            path: "/api/events",
            method: "POST",
            body: body,
            token: token
        )
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?,
        token: String?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if (200 ..< 300).contains(http.statusCode) {
            do {
                return try JSONDecoder().decode(Response.self, from: data)
            } catch {
                throw APIClientError.decodingFailed
            }
        }

        let message = (try? JSONDecoder().decode(APIErrorResponse.self, from: data))?.error
            ?? String(data: data, encoding: .utf8)
            ?? "Request failed"
        throw APIClientError.httpError(status: http.statusCode, message: message)
    }
}

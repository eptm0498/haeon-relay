import Foundation

struct LiveAPI {
    static let origin = URL(string: "https://haeon-relay.vercel.app")!
    static let jiwoo = "8bda7b48-b3bc-4c8e-900b-7b92b04fe21c"
    static let environment = Bundle.main.object(forInfoDictionaryKey: "LiveAPNSEnvironment") as? String ?? "production"

    struct Failure: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }

    struct Turn: Codable {
        let role: String
        let content: String
    }

    private let session = URLSession.shared

    var signedIn: Bool {
        let url = Self.origin.appendingPathComponent("api/dokyeong/ios-device")
        return HTTPCookieStorage.shared.cookies(for: url)?.contains {
            $0.name == "dokyeong_live_session" && ($0.expiresDate ?? .distantPast) > Date()
        } == true
    }

    func login(_ code: String) async throws {
        _ = try await json("login", ["code": code])
    }

    func clearLogin() {
        let url = Self.origin.appendingPathComponent("api/dokyeong/ios-device")
        for cookie in HTTPCookieStorage.shared.cookies(for: url) ?? [] where cookie.name == "dokyeong_live_session" {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func register(_ token: String, action: String = "register") async throws {
        _ = try await json("ios-device", ["action": action, "token": token, "environment": Self.environment])
    }

    func decide(_ id: UUID, _ action: String) async throws {
        _ = try await json("incoming-call", ["id": id.uuidString.lowercased(), "action": action], timeout: 8)
    }

    func callStatus(_ id: UUID) async throws -> String {
        var url = URLComponents(url: Self.origin.appendingPathComponent("api/dokyeong/incoming-call"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "id", value: id.uuidString.lowercased())]
        let (data, response) = try await session.data(for: URLRequest(url: url.url!, timeoutInterval: 6))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(status: 503, message: "전화 상태를 확인하지 못했어.") }
        struct State: Decodable { let status: String }
        return try JSONDecoder().decode(State?.self, from: data)?.status ?? "missed"
    }

    struct Conversation {
        let epoch: String
        let turns: [Turn]
    }
    private struct HistoryRow: Decodable {
        let character_id: String
        let epoch: String
        let messages: [Turn]
    }

    func conversation() async throws -> Conversation {
        let data = try await send("history", method: "GET", timeout: 10)
        let rows = try JSONDecoder().decode([HistoryRow].self, from: data)
        guard let row = rows.first(where: { $0.character_id == Self.jiwoo }) else {
            throw Failure(status: 404, message: "LIVE에서 지우 채팅방을 먼저 열어줘.")
        }
        return Conversation(epoch: row.epoch, turns: row.messages.filter { !$0.content.isEmpty })
    }

    func append(_ turns: [Turn], epoch: String) async throws {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let messages: [[String: Any]] = turns.enumerated().map { index, turn in
            ["id": UUID().uuidString.lowercased(), "role": turn.role, "content": turn.content, "ts": now + index]
        }
        _ = try await json("history", ["action": "append", "characterId": Self.jiwoo, "epoch": epoch, "messages": messages])
    }

    func respond(_ turns: [Turn], opening: UUID? = nil) async throws -> String {
        let messages = turns.suffix(24).map { ["role": $0.role, "content": String($0.content.prefix(1400))] }
        var payload: [String: Any] = ["characterId": Self.jiwoo, "voice": false, "realtime": true, "messages": messages]
        if let opening { payload["openingCallId"] = opening.uuidString.lowercased() }
        let data = try await json("respond", payload, timeout: 55)
        struct Frame: Decodable { let type: String; let text: String? }
        for line in data.split(separator: 10).reversed() {
            if let frame = try? JSONDecoder().decode(Frame.self, from: Data(line)),
               frame.type == "done", let text = frame.text, !text.isEmpty { return text }
        }
        throw Failure(status: 502, message: "지우의 음성 답변을 받지 못했어.")
    }

    func transcribe(_ audio: Data) async throws -> String {
        let boundary = UUID().uuidString
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"speech.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".utf8)
        body.append(audio)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let data = try await send("transcribe", body: body, type: "multipart/form-data; boundary=\(boundary)", timeout: 22)
        struct Result: Decodable { let text: String }
        return try JSONDecoder().decode(Result.self, from: data).text
    }

    func speak(_ text: String) async throws -> Data {
        try await json("tts", ["characterId": Self.jiwoo, "text": String(text.prefix(700))], timeout: 45)
    }

    private func json(_ path: String, _ body: [String: Any], timeout: TimeInterval = 15) async throws -> Data {
        try await send(path, body: JSONSerialization.data(withJSONObject: body), type: "application/json", timeout: timeout)
    }

    private func send(_ path: String, method: String = "POST", body: Data? = nil,
                      type: String? = nil, timeout: TimeInterval) async throws -> Data {
        var request = URLRequest(url: Self.origin.appendingPathComponent("api/dokyeong/" + path),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue(Self.origin.absoluteString, forHTTPHeaderField: "Origin")
        if let type { request.setValue(type, forHTTPHeaderField: "Content-Type") }
        request.httpBody = body
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 500
        guard (200..<300).contains(status) else {
            struct ErrorBody: Decodable { let error: String }
            let text = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
            throw Failure(status: status, message: text ?? (status == 409 ? "이미 종료된 전화야." : "LIVE 서버와 연결하지 못했어."))
        }
        return data
    }
}

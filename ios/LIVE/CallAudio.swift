import AVFoundation
import Foundation

@MainActor
final class CallAudio {
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var file: URL?
    private var task: Task<Void, Never>?

    func start(_ id: UUID, api: LiveAPI, status: @escaping @MainActor (String) -> Void,
               failed: @escaping @MainActor () -> Void) {
        stop()
        task = Task {
            do {
                var conversation = try await api.conversation()
                let greeting = try await api.respond(conversation.turns, opening: id)
                try Task.checkCancellation()
                try await play(greeting, api: api, status: status)
                let opening = LiveAPI.Turn(role: "assistant", content: greeting)
                try? await api.append([opening], epoch: conversation.epoch)
                conversation = .init(epoch: conversation.epoch, turns: conversation.turns + [opening])
                while !Task.isCancelled {
                    status("듣고 있어")
                    let audio = try await recordTurn()
                    status("답장 중")
                    let text = try await api.transcribe(audio).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { continue }
                    let user = LiveAPI.Turn(role: "user", content: String(text.prefix(1400)))
                    let reply = try await api.respond(conversation.turns + [user])
                    try Task.checkCancellation()
                    let assistant = LiveAPI.Turn(role: "assistant", content: reply)
                    try? await api.append([user, assistant], epoch: conversation.epoch)
                    conversation = .init(epoch: conversation.epoch, turns: Array((conversation.turns + [user, assistant]).suffix(24)))
                    try await play(reply, api: api, status: status)
                }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                status(error.localizedDescription)
                failed()
            }
        }
    }

    private func play(_ text: String, api: LiveAPI, status: (String) -> Void) async throws {
        let audio = try await api.speak(text)
        try Task.checkCancellation()
        let player = try AVAudioPlayer(data: audio)
        self.player = player
        status("지우가 말하는 중")
        guard player.play() else { throw AudioError.playback }
        while player.isPlaying { try await Task.sleep(nanoseconds: 100_000_000) }
        self.player = nil
    }

    private func recordTurn() async throws -> Data {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
        self.file = file
        let recorder = try AVAudioRecorder(url: file, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 24_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 48_000,
        ])
        self.recorder = recorder
        defer {
            recorder.stop()
            self.recorder = nil
            try? FileManager.default.removeItem(at: file)
            self.file = nil
        }
        recorder.isMeteringEnabled = true
        guard recorder.record() else { throw AudioError.recording }
        var speechStart: TimeInterval?
        var lastSpeech: TimeInterval = 0
        while recorder.isRecording {
            try await Task.sleep(nanoseconds: 100_000_000)
            recorder.updateMeters()
            let elapsed = recorder.currentTime
            if recorder.averagePower(forChannel: 0) > -43 {
                speechStart = speechStart ?? elapsed
                lastSpeech = elapsed
            }
            if let speechStart {
                if elapsed - lastSpeech > 0.9 || elapsed - speechStart > 22 { break }
            } else if elapsed > 60 {
                throw AudioError.idle
            }
        }
        try Task.checkCancellation()
        recorder.stop()
        return try Data(contentsOf: file)
    }

    func stop() {
        task?.cancel()
        task = nil
        recorder?.stop()
        player?.stop()
        recorder = nil
        player = nil
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
    }

    private enum AudioError: LocalizedError {
        case recording, playback, idle
        var errorDescription: String? {
            switch self {
            case .recording: return "마이크를 켜지 못했어."
            case .playback: return "음성을 재생하지 못했어."
            case .idle: return "1분 동안 말이 없어서 통화를 종료했어."
            }
        }
    }
}

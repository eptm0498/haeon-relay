import AVFoundation
import CallKit
import Combine
import PushKit
import UIKit

@MainActor
final class CallCoordinator: NSObject, ObservableObject, PKPushRegistryDelegate, CXProviderDelegate {
    static let shared = CallCoordinator()

    @Published private(set) var signedIn = false
    @Published private(set) var registered = false
    @Published private(set) var inCall = false
    @Published private(set) var status = ""
    private let api = LiveAPI()
    private let audio = CallAudio()
    private let provider: CXProvider
    private let controller = CXCallController()
    private var registry: PKPushRegistry?
    private var token: String?
    private var registeredToken: String?
    private var ringing: [UUID: Date] = [:]
    private var answered: UUID?
    private var connecting: UUID?
    private var audioActive = false
    private var startedAudio = false
    private var refreshInProgress = false

    private override init() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = true
        provider = CXProvider(configuration: configuration)
        super.init()
        signedIn = api.signedIn
        provider.setDelegate(self, queue: .main)
        let registry = PKPushRegistry(queue: .main)
        self.registry = registry
        registry.delegate = self
        if signedIn { registry.desiredPushTypes = [.voIP] }
    }

    func login(_ code: String) async {
        do {
            try await api.login(code)
            signedIn = true
            registry?.desiredPushTypes = [.voIP]
            await refreshRegistration()
        } catch {
            status = error.localizedDescription
        }
    }

    func refreshRegistration() async {
        guard signedIn, api.signedIn else {
            signedIn = false
            registered = false
            return
        }
        guard let token, !refreshInProgress else { return }
        refreshInProgress = true
        defer { refreshInProgress = false }
        do {
            try await api.register(token)
            registeredToken = token
            registered = true
            status = "지우의 전화를 받을 수 있어."
        } catch {
            registered = false
            status = error.localizedDescription
        }
    }

    func logout() async {
        guard !inCall, ringing.isEmpty, !refreshInProgress else { return }
        do {
            if let token = registeredToken ?? token { try await api.register(token, action: "unregister") }
            api.clearLogin()
            registry?.desiredPushTypes = []
            registered = false
            registeredToken = nil
            token = nil
            signedIn = false
            status = ""
        } catch {
            status = error.localizedDescription
        }
    }

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let updated = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        let previous = registeredToken
        token = updated
        Task {
            await refreshRegistration()
            if let previous, previous != updated, registered { try? await api.register(previous, action: "unregister") }
        }
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        if let token, signedIn { Task { try? await api.register(token, action: "unregister") } }
        token = nil
        registeredToken = nil
        registered = false
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }
        let callId = (payload.dictionaryPayload["callId"] as? String).flatMap(UUID.init(uuidString:))
        let milliseconds = (payload.dictionaryPayload["expiresAt"] as? NSNumber)?.doubleValue ?? 0
        let expiration = Date(timeIntervalSince1970: milliseconds / 1000)
        let id = callId ?? UUID()
        let valid = callId != nil && expiration > Date() && api.signedIn && answered == nil
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: "지우")
        update.localizedCallerName = "지우"
        update.hasVideo = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        let wasAlreadyRinging = ringing[id] != nil
        if valid && !wasAlreadyRinging { ringing[id] = expiration }
        provider.reportNewIncomingCall(with: id, update: update) { [weak self] error in
            DispatchQueue.main.async {
                defer { completion() }
                guard let self else { return }
                if error != nil {
                    if !wasAlreadyRinging && self.ringing[id] == expiration { self.ringing.removeValue(forKey: id) }
                    return
                }
                if !valid {
                    self.provider.reportCall(with: id, endedAt: Date(), reason: .unanswered)
                    return
                }
                if !wasAlreadyRinging {
                    self.scheduleExpiry(id, at: expiration)
                    self.watchCall(id, until: expiration)
                }
            }
        }
    }

    private func scheduleExpiry(_ id: UUID, at expiration: Date) {
        Task {
            try? await Task.sleep(nanoseconds: UInt64(max(0, expiration.timeIntervalSinceNow) * 1_000_000_000))
            guard ringing.removeValue(forKey: id) != nil, connecting != id else { return }
            provider.reportCall(with: id, endedAt: Date(), reason: .unanswered)
        }
    }

    private func watchCall(_ id: UUID, until expiration: Date) {
        Task {
            while ringing[id] != nil, expiration > Date() {
                if connecting != id, let status = try? await api.callStatus(id),
                   status != "ringing", connecting != id, ringing.removeValue(forKey: id) != nil {
                    let reason: CXCallEndedReason = status == "accepted" ? .answeredElsewhere :
                        status == "declined" ? .declinedElsewhere : .unanswered
                    provider.reportCall(with: id, endedAt: Date(), reason: reason)
                    return
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        let id = action.callUUID
        guard let expiration = ringing[id], expiration > Date(), answered == nil else { action.fail(); return }
        connecting = id
        Task {
            var serverAccepted = false
            do {
                guard AVAudioSession.sharedInstance().recordPermission == .granted else {
                    throw LiveAPI.Failure(status: 403, message: "LIVE 앱을 열고 마이크 권한을 허용해줘.")
                }
                try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
                try await api.decide(id, "accept")
                serverAccepted = true
                guard connecting == id else {
                    try? await api.decide(id, "failed")
                    return
                }
                connecting = nil
                ringing.removeValue(forKey: id)
                answered = id
                inCall = true
                status = "지우와 연결 중"
                action.fulfill()
                beginAudioIfReady()
            } catch {
                guard connecting == id else { return }
                connecting = nil
                ringing.removeValue(forKey: id)
                status = error.localizedDescription
                action.fail()
                let reason: CXCallEndedReason = (error as? LiveAPI.Failure)?.status == 409 ? .answeredElsewhere : .failed
                provider.reportCall(with: id, endedAt: Date(), reason: reason)
                if serverAccepted { try? await api.decide(id, "failed") }
            }
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let id = action.callUUID
        if answered == id {
            if !startedAudio { Task { try? await api.decide(id, "failed") } }
            stopAudio()
        } else if ringing.removeValue(forKey: id) != nil {
            if connecting == id { connecting = nil }
            Task { try? await api.decide(id, "decline") }
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        if let call = action as? CXAnswerCallAction, connecting == call.callUUID {
            connecting = nil
            ringing.removeValue(forKey: call.callUUID)
            provider.reportCall(with: call.callUUID, endedAt: Date(), reason: .failed)
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        if let answered, !startedAudio { Task { try? await api.decide(answered, "failed") } }
        ringing.removeAll()
        connecting = nil
        stopAudio()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        audioActive = true
        beginAudioIfReady()
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        audioActive = false
        if let id = answered {
            provider.reportCall(with: id, endedAt: Date(), reason: .failed)
            if !startedAudio { Task { try? await api.decide(id, "failed") } }
            stopAudio()
        }
    }

    private func beginAudioIfReady() {
        guard audioActive, let id = answered, !startedAudio else { return }
        startedAudio = true
        audio.start(id, api: api, status: { [weak self] value in self?.status = value }, failed: { [weak self] in
            guard let self, self.answered == id else { return }
            self.provider.reportCall(with: id, endedAt: Date(), reason: .failed)
            self.stopAudio()
            Task { try? await self.api.decide(id, "failed") }
        })
    }

    func hangUp() {
        guard let id = answered else { return }
        controller.request(CXTransaction(action: CXEndCallAction(call: id))) { [weak self] error in
            guard error != nil else { return }
            DispatchQueue.main.async {
                guard let self, self.answered == id else { return }
                self.provider.reportCall(with: id, endedAt: Date(), reason: .failed)
                self.stopAudio()
            }
        }
    }

    private func stopAudio() {
        audio.stop()
        answered = nil
        inCall = false
        startedAudio = false
        audioActive = false
    }
}

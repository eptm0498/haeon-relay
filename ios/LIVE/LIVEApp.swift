import AVFoundation
import SwiftUI
import UIKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        _ = CallCoordinator.shared
        return true
    }
}

@main
@MainActor
struct LIVEApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup { CallSettings() }
    }
}

@MainActor
private struct CallSettings: View {
    @ObservedObject private var calls = CallCoordinator.shared
    @Environment(\.scenePhase) private var phase
    @State private var code = ""
    @State private var loading = false
    @State private var microphone = AVAudioSession.sharedInstance().recordPermission == .granted

    var body: some View {
        NavigationStack {
            Form {
                if calls.inCall {
                    Section("통화 중") {
                        LabeledContent("지우", value: calls.status)
                        Button("통화 종료", role: .destructive) { calls.hangUp() }
                    }
                } else if calls.signedIn {
                    Section("수신 전화") {
                        LabeledContent("지우", value: calls.registered && microphone ? "수신 준비됨" : "설정 필요")
                        if !microphone {
                            Button("마이크 허용") { requestMicrophone() }
                        }
                        Button("수신 설정 다시 확인") { Task { await calls.refreshRegistration() } }
                        Text("지우의 전화는 아이폰 수신 화면에서 받거나 거절할 수 있어.")
                    }
                    Section {
                        Link("LIVE 채팅 열기", destination: LiveAPI.origin.appendingPathComponent("dokyeong-live"))
                        Button("로그아웃", role: .destructive) { Task { await calls.logout() } }
                    }
                } else {
                    Section("LIVE 연결") {
                        SecureField("LIVE 접속 코드", text: $code)
                            .textContentType(.password)
                            .autocorrectionDisabled()
                        Button("연결") {
                            let value = code.trimmingCharacters(in: .whitespacesAndNewlines)
                            code = ""
                            loading = true
                            Task {
                                await calls.login(value)
                                if calls.signedIn { requestMicrophone() }
                                loading = false
                            }
                        }.disabled(loading || code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                if !calls.status.isEmpty && !calls.inCall { Text(calls.status).foregroundStyle(.secondary) }
            }
            .navigationTitle("LIVE")
        }
        .task(id: phase) {
            if phase == .active {
                microphone = AVAudioSession.sharedInstance().recordPermission == .granted
                await calls.refreshRegistration()
            }
        }
    }

    private func requestMicrophone() {
        if AVAudioSession.sharedInstance().recordPermission == .denied {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { allowed in
                DispatchQueue.main.async {
                    microphone = allowed
                    if allowed { Task { await calls.refreshRegistration() } }
                }
            }
        }
    }
}

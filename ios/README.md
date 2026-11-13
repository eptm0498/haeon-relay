# LIVE for iPhone

`LIVE.xcodeproj` is the companion app for accepting Jiwoo calls on the iOS system screen. Chat and character settings are served by the existing LIVE site. The iOS app records audio only after the system answer action and uses the existing Gemini and ElevenLabs endpoints.

## Install and connect

1. Open `ios/LIVE.xcodeproj` in Xcode and select the Apple Developer team for the LIVE target. Register an explicit App ID with Push Notifications enabled. The project uses `app.haeonrelay.live` as a starting bundle identifier. Set the actual registered ID in both configurations.
2. Create an APNs token-signing key with access to the app's VoIP topic. Configure `LIVE_APNS_TEAM_ID`, `LIVE_APNS_KEY_ID`, `LIVE_APNS_KEY` and `LIVE_APNS_BUNDLE_ID` in the existing Vercel project. The key is the private .p8 content and belongs only in server secrets. Development uses sandbox APNs and the TestFlight archive uses production APNs.
3. Build to an enrolled iPhone or distribute through TestFlight. Open LIVE once, enter the existing LIVE access code and allow microphone access. The status should read **수신 준비됨** before a device test.
4. Lock the iPhone or move the app to the background. From the existing LIVE chat on another device, send Jiwoo **지금 전화 걸어줘**. Verify system answer, greeting, two-way audio, end, decline, and timeout on separate calls. When native delivery is confirmed, the duplicate web alert can be disabled on the iPhone home-screen web app if desired.

The signed-in device registration expires after 30 days without opening the native app. Opening the app refreshes it. After manually force-quitting the native app from the app switcher, reopen it before relying on background calling.

# 도경LIVE

Route: `/dokyeong-live` (iPhone Safari, 홈 화면 추가 가능)

## Production environment variables

Required in Vercel for Production and Preview:

| Name | Purpose |
| --- | --- |
| `DOKYEONG_ACCESS_CODE` | Private access code; choose at least 12 unpredictable characters |
| `GEMINI_API_KEY` | Text responses for chat and calls |
| `OPENAI_API_KEY` | Image generation |
| `ELEVENLABS_API_KEY` | Speech synthesis and Scribe v3 speech transcription; enable Speech to Text access |

Optional:

| Name | Default |
| --- | --- |
| `DOKYEONG_GEMINI_MODEL` | `gemini-3.8-flash` |
| `DOKYEONG_GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash` |
| `DOKYEONG_VOICE_ID` | Default voice for the built-in character |
| `DOKYEONG_VOICE_STABILITY` | `0.45` |
| `DOKYEONG_VOICE_SIMILARITY` | `0.8` |
| `DOKYEONG_VOICE_STYLE` | `0` |
| `DOKYEONG_VOICE_SPEED` | `1` |

The browser synchronizes conversation history with the server and keeps a local text cache. Voice synthesis can begin as soon as a phrase arrives from the text stream when a realtime synthesis model is selected. The microphone uses local energy detection, then sends each completed recording to ElevenLabs. The default recognition model is Scribe v3 with Korean selected. During calls, the response delay display measures the time from recording completion to the start of audio playback. If recognition fails, the app shows an error and can process the next utterance. The live client uses a signed, HttpOnly, SameSite cookie and its write endpoints reject cross-origin requests.

## Character editor

The live character instructions are stored in `public.dokyeong_character_settings` and are read on each new response. The default in `lib/dokyeong/character.ts` is used if no edited record exists or the settings service is unavailable. The editor is available at `/dokyeong-live/edit/<64-character editor token>` without a login. The link grants edit access, so keep the token out of the repository and share it only with intended editors.

Apply `supabase/migrations/20260930_dokyeong_editor.sql`, then generate a random 32-byte hex token separately and store **only its SHA-256 hash** in `private.dokyeong_editor_key` at id 1. The production database was provisioned separately. The token is never committed. The RPC verifies it before saving. The public read RPC supplies the runtime character text; do not put private secrets in the character instructions.

## Dialogue samples

The editor has a separate **대화 샘플** menu. It accepts a KakaoTalk exported `.txt` file, asks which speaker is 도경, previews extracted turns, and imports them. Each sample keeps the previous message, the original reply, and an editable spoken version. Search or filter by enabled state to edit, switch on/off, add, or delete individual samples. Enabled examples are retrieved only for a closely matching cue and supplement the character instructions; historical events are not treated as current facts.

The sample table and the runtime reader key are in the private Supabase schema. Apply `supabase/migrations/20260929194820_dokyeong_dialogue_samples.sql` to a fresh project. The editor token controls writes, and a server-derived reader key controls sample lookup. Raw KakaoTalk exports must not be committed to Git. Import can be repeated: content hashes skip duplicates. The initial import stores every eligible adjacent turn, while only individually reviewed examples start enabled. Review sensitive or context-dependent samples in the editor before enabling them.

Test on an actual iPhone after environment setup: Safari microphone permission; speak and pause; interrupt while sound plays; mute/unmute; hide/reopen Safari; add to Home Screen. Mobile background capture is suspended and needs a tap to resume. The 3-second first-audio goal is a target, not a measured result until the real APIs and an iPhone are available.

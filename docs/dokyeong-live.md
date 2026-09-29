# 도경LIVE

Route: `/dokyeong-live` (iPhone Safari, 홈 화면 추가 가능)

## Production environment variables

Required in Vercel for Production and Preview:

| Name | Purpose |
| --- | --- |
| `DOKYEONG_ACCESS_CODE` | Private access code; choose at least 12 unpredictable characters |
| `OPENAI_API_KEY` | Speech transcription and streamed text response |
| `ELEVENLABS_API_KEY` | Speech synthesis for the cloned voice |

Optional:

| Name | Default |
| --- | --- |
| `DOKYEONG_OPENAI_MODEL` | `gpt-4o-mini` (temporary, replace when selected) |
| `DOKYEONG_STT_MODEL` | `gpt-4o-mini-transcribe` |
| `DOKYEONG_VOICE_ID` | `peTGXjUdPy5VJNYTcdea` |
| `DOKYEONG_TTS_MODEL` | `eleven_flash_v2_5` |
| `DOKYEONG_VOICE_STABILITY` | `0.45` |
| `DOKYEONG_VOICE_SIMILARITY` | `0.8` |
| `DOKYEONG_VOICE_STYLE` | `0.15` |
| `DOKYEONG_VOICE_SPEED` | `1` |

The character instructions are in `lib/dokyeong/config.ts`. The browser keeps the last 40 messages locally; only the most recent 24 go to OpenAI on each turn. Voice requests begin as soon as a phrase arrives from the text stream. The microphone uses local energy detection to avoid uploading silence. API routes require a signed, HttpOnly, SameSite cookie, and reject cross-origin POSTs. No API keys are sent to the browser.

## Character editor

The live character instructions are stored in `public.dokyeong_character_settings` and are read on each new response. The default in `lib/dokyeong/character.ts` is used if no edited record exists or the settings service is unavailable. The editor is available at `/dokyeong-live/edit/<64-character editor token>` without a login. The link grants edit access, so keep the token out of the repository and share it only with intended editors.

Apply `supabase/migrations/20260930_dokyeong_editor.sql`, then generate a random 32-byte hex token separately and store **only its SHA-256 hash** in `private.dokyeong_editor_key` at id 1. The production database was provisioned separately. The token is never committed. The RPC verifies it before saving. The public read RPC supplies the runtime character text; do not put private secrets in the character instructions.

Test on an actual iPhone after environment setup: Safari microphone permission; speak and pause; interrupt while sound plays; mute/unmute; hide/reopen Safari; add to Home Screen. Mobile background capture is suspended and needs a tap to resume. The 3-second first-audio goal is a target, not a measured result until the real APIs and an iPhone are available.

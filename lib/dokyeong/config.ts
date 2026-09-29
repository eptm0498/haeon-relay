/** Server-only settings. Never import this module into a client component. */
export const liveConfig = {
  openai: {
    provider: "openai",
    transcriptionModel: process.env.DOKYEONG_STT_MODEL || "gpt-transcribe",
  },
  gemini: {
    provider: "gemini",
    responseModel: process.env.DOKYEONG_GEMINI_MODEL || "gemini-3.1-pro-preview",
    fallbackModel: process.env.DOKYEONG_GEMINI_FALLBACK_MODEL || "gemini-3.8-flash",
  },
  elevenlabs: {
    voiceId: process.env.DOKYEONG_VOICE_ID || "peTGXjUdPy5VJNYTcdea",
    modelId: process.env.DOKYEONG_TTS_MODEL || "eleven_flash_v2_5",
    stability: Number(process.env.DOKYEONG_VOICE_STABILITY || "0.45"),
    similarityBoost: Number(process.env.DOKYEONG_VOICE_SIMILARITY || "0.8"),
    style: Number(process.env.DOKYEONG_VOICE_STYLE || "0.15"),
    speed: Number(process.env.DOKYEONG_VOICE_SPEED || "1"),
  },
};

export { dokyeongPrompt } from "./character";

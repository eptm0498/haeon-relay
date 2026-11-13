const geminiModels = {
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
};

export const liveModelFields = {
  textModel: {
    label: "문자 채팅 답변 · Google Gemini",
    models: geminiModels,
  },
  voiceModel: {
    label: "음성 통화 답변 · Google Gemini",
    models: geminiModels,
  },
  speechModel: {
    label: "캐릭터 목소리 합성 · ElevenLabs",
    models: {
      eleven_v3_conversational: "Eleven v3 Conversational · 실시간",
      eleven_v4_turbo: "Eleven v4 Turbo · 실시간",
      eleven_v3: "Eleven v3 · 답변 완성 후 재생",
      eleven_v4: "Eleven v4 · 답변 완성 후 재생",
      eleven_flash_v2_5: "Eleven Flash v2.5 · 답변 완성 후 재생",
      eleven_turbo_v2_5: "Eleven Turbo v2.5 · 답변 완성 후 재생",
      eleven_multilingual_v2: "Eleven Multilingual v2 · 답변 완성 후 재생",
    },
  },
  transcriptionModel: {
    label: "내 목소리 인식 · ElevenLabs",
    models: {
      scribe_v3: "Scribe v3",
      scribe_v2: "Scribe v2",
    },
  },
};

export type LiveModelField = keyof typeof liveModelFields;
export type LiveModelOverrides = Record<LiveModelField, string | null>;

export const liveModelKeys = Object.keys(liveModelFields) as LiveModelField[];

export type LiveModelSettings = {
  overrides: LiveModelOverrides;
  defaults: Record<LiveModelField, string>;
  version: number;
};

type GeminiModelDetails = {
  name: string;
  paid: { input: number; output: number; offerUntil?: string; afterOffer?: { input: number; output: number } };
  benchmark: { tokensPerSecond: number; firstTokenSeconds: number; thinking?: string };
};

const flashIntroductoryRate = { input: 0.75, output: 3.75, offerUntil: "2026.12.31", afterOffer: { input: 1.5, output: 7.5 } };

// Generally available Gemini Developer API models with a free text tier.
// Google pricing and Artificial Analysis benchmarks checked 2026-11-15.
export const geminiFreeModels: Readonly<Record<string, GeminiModelDetails>> = {
  "gemini-4-hydrogen": {
    name: "Gemini 4 Hydrogen",
    paid: { input: 1.5, output: 7.5 },
    benchmark: { tokensPerSecond: 167, firstTokenSeconds: 5.7, thinking: "Low" },
  },
  "gemini-3.8-flash": {
    name: "Gemini 3.8 Flash",
    paid: flashIntroductoryRate,
    benchmark: { tokensPerSecond: 103, firstTokenSeconds: 4.1, thinking: "Low" },
  },
  "gemini-3.6-flash": {
    name: "Gemini 3.6 Flash",
    paid: flashIntroductoryRate,
    benchmark: { tokensPerSecond: 161, firstTokenSeconds: 12.4, thinking: "High" },
  },
  "gemini-3.5-flash-lite": {
    name: "Gemini 3.5 Flash-Lite",
    paid: { input: 0.3, output: 2.5 },
    benchmark: { tokensPerSecond: 293, firstTokenSeconds: 4.7 },
  },
  "gemini-3.1-flash-lite": {
    name: "Gemini 3.1 Flash-Lite",
    paid: { input: 0.25, output: 1.5 },
    benchmark: { tokensPerSecond: 308, firstTokenSeconds: 4.2 },
  },
};

const geminiAliases = {
  "gemini-3.7-flash": "gemini-3.8-flash",
  "gemini-3.5-flash": "gemini-3.6-flash",
};

export function currentGeminiModel(id: string | null | undefined) {
  if (!id) return null;
  const canonical = geminiAliases[id as keyof typeof geminiAliases] ?? id;
  return Object.hasOwn(geminiFreeModels, canonical) ? canonical : null;
}

const geminiModels = Object.fromEntries(Object.entries(geminiFreeModels).map(([id, model]) => [id, model.name]));

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

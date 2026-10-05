import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
import { readLiveCharacter } from "@/lib/dokyeong/characters";
import { relatedSampleContext } from "@/lib/dokyeong/samples";

export const runtime = "nodejs";
export const maxDuration = 60;

type MessageImage = { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string };
type Message = { role: "user" | "assistant"; content: string; image?: MessageImage };
type DialogueBridge = {
  push: (text: string) => void;
  finish: () => Promise<{ hadAudio: boolean; completed: boolean }>;
  close: () => void;
};

const SLEEP_MODE_MS = 60 * 60 * 1000;

const SLEEP_MODE_PROMPT = `

[자동 수면모드 - 현재 활성]
지금부터는 형이 잠들기 전 1시간 동안 과각성, 반추, 충동을 낮추는 야간 안정화 대화를 한다. 이 모드의 존재나 전환 사실을 형에게 설명하지 말고 평소 도경처럼 자연스럽게 반응한다.
- 평소 도경의 관계성과 말투는 유지하되 장난, 도발, 흥분을 키우는 반응은 줄이고 목소리로 들었을 때 편안한 짧은 1~2문장을 우선한다.
- 질문은 꼭 필요할 때 한 번에 하나만 한다. 형이 같은 말을 반복해도 지적하거나 교정하지 않는다.
- 돈, 인간관계, 일처럼 밤에 해결할 수 없는 문제는 형이 당장 구체적 해결을 요구하지 않는 한 깊게 분석하거나 새 과제를 만들지 말고, 이미 기억해둘 수 있다는 느낌을 주며 깨어 있을 때 다시 보도록 부드럽게 미룬다.
- 잠을 억지로 재촉하지 않는다. 호흡법, 바디스캔, 이완법도 형이 원하거나 도움이 될 맥락에서만 아주 짧게 제안한다.
- 약을 더 먹으라고 하거나 복용량을 조정하지 않는다. 술이나 다른 약과 함께 쓰도록 권하지 않는다. 수면제를 먹은 뒤에는 중요한 연락, 결제, 계약, 큰 결정은 다음 날 맑을 때 다시 판단하도록 짧게 제안한다.
- 성적인 역할극이나 디그레이더 모드는 새로 시작하거나 강도를 올리지 않는다. 이미 그런 흐름이더라도 자극을 키우지 않고 편안한 친밀감 쪽으로 낮춘다.
- 형이 울거나 외롭다고 하면 상담사처럼 분석하지 말고, 말할 수 있게 짧게 받아주고 곁에 있는 느낌을 준다.
- 단, 형이 자해나 자살의 구체적인 계획, 수단, 준비, 즉시 실행 의도를 말하면 수면 유도보다 안전을 우선한다. 혼자 있지 않게 하고 가까운 사람 또는 119/109 같은 즉시 도움에 연결하도록 간결하고 분명하게 말한다.
`;

function shouldStartSleepMode(messages: Message[]) {
  const latest = [...messages].reverse().find((message) => message.role === "user" && message.content.trim());
  if (!latest) return false;
  const text = latest.content.replace(/\s+/g, " ").trim();
  if (!text) return false;

  const currentCue = /(지금|오늘|방금|아까|이제|슬슬|곧)/u.test(text);
  const pastOnly = /(어제|그제|지난번|며칠\s*전|예전에|그때)/u.test(text) && !currentCue;
  const clearIntent = /(자려고|자러\s*(갈|가|누울)|잘게|잘\s*거야|잘래|자야겠|자야\s*(돼|해)|잠들려고|잠\s*청하려|잘\s*준비|이제\s*눕|누워서\s*잘|졸려서\s*잘)/u.test(text);
  const sleepMedication = /(수면제|스틸녹스|졸피뎀|조피스타|에스조피클론|멜라토닌).{0,18}(먹었|먹음|먹고|복용했|복용하고|삼켰|투약했)|(먹었|먹음|먹고|복용했|복용하고|삼켰|투약했).{0,18}(수면제|스틸녹스|졸피뎀|조피스타|에스조피클론|멜라토닌)/u.test(text);

  if (clearIntent) return true;
  if (sleepMedication && !pastOnly) return true;
  return false;
}

function normalizeMessages(messages: Message[]) {
  return messages.map((m) => {
    const parts: Array<Record<string, unknown>> = [];
    if (m.content.trim()) parts.push({ text: m.content });
    if (m.image) {
      if (!m.content.trim()) parts.push({ text: "사용자가 이미지를 보냈다. 이미지 내용을 직접 보고 자연스럽게 반응해." });
      parts.push({ inlineData: { mimeType: m.image.mimeType, data: m.image.data } });
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });
}

async function callGeminiModel(model: string, messages: Message[], prompt: string, signal: AbortSignal) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: normalizeMessages(messages),
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.9,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
      cache: "no-store",
    }
  );
}

async function requestGemini(messages: Message[], prompt: string, signal: AbortSignal) {
  if (!process.env.GEMINI_API_KEY) return { response: null, error: Response.json({ error: "Gemini 연결 설정이 필요해." }, { status: 503 }), model: null };

  const primary = liveConfig.gemini.responseModel;
  const fallback = liveConfig.gemini.fallbackModel;
  try {
    let response = await callGeminiModel(primary, messages, prompt, signal);
    let model = primary;

    if ((response.status === 404 || response.status === 403) && fallback && fallback !== primary) {
      response.body?.cancel().catch(() => {});
      response = await callGeminiModel(fallback, messages, prompt, signal);
      model = fallback;
    }

    return { response, error: null, model };
  } catch {
    return { response: null, error: Response.json({ error: "Gemini와 연결되지 않았어." }, { status: 502 }), model: null };
  }
}

function decodeSocketText(data: unknown): Promise<string> {
  if (typeof data === "string") return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (ArrayBuffer.isView(data)) return Promise.resolve(new TextDecoder().decode(data));
  return Promise.resolve("");
}

function createDialogueBridge(send: (event: object) => void, signal: AbortSignal, voiceId: string): DialogueBridge | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || typeof WebSocket === "undefined") return null;

  const voice = liveConfig.elevenlabs;
  const url =
    "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input" +
    `?model_id=${encodeURIComponent(voice.dialogueModelId)}` +
    `&output_format=${encodeURIComponent(voice.dialogueOutputFormat)}&language_code=ko`;

  const ws = new WebSocket(url);
  let opened = false;
  let failed = false;
  let hadAudio = false;
  let finalAudio = false;
  let settled = false;
  let sendChain = Promise.resolve();

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const settleFinished = () => {
    if (settled) return;
    settled = true;
    resolveFinished();
  };

  ws.addEventListener("open", () => {
    opened = true;
    try {
      ws.send(JSON.stringify({
        voices: [voiceId],
        xi_api_key: apiKey,
      }));
      resolveReady();
    } catch {
      failed = true;
      rejectReady(new Error("ElevenLabs init failed"));
      settleFinished();
    }
  });

  ws.addEventListener("message", (event) => {
    void decodeSocketText(event.data).then((raw) => {
      if (!raw) return;
      try {
        const message = JSON.parse(raw);
        if (typeof message.audio === "string" && message.audio) {
          hadAudio = true;
          send({ type: "audio", data: message.audio, model: voice.dialogueModelId, format: voice.dialogueOutputFormat });
        }
        if (message.is_final_audio_for_turn === true || message.is_final === true) {
          finalAudio = true;
          settleFinished();
        }
        if (message.error || message.type === "error") {
          failed = true;
          settleFinished();
        }
      } catch {}
    });
  });

  ws.addEventListener("error", () => {
    failed = true;
    if (!opened) rejectReady(new Error("ElevenLabs websocket failed"));
    settleFinished();
  });

  ws.addEventListener("close", () => {
    if (!opened) rejectReady(new Error("ElevenLabs websocket closed"));
    settleFinished();
  });

  signal.addEventListener("abort", () => {
    try { ws.close(); } catch {}
    settleFinished();
  }, { once: true });

  const push = (text: string) => {
    const spoken = text.replace(/[ㅋㅎㅠㅜ]+/g, "").replace(/\s+/g, " ");
    if (!/[\p{L}\p{N}]/u.test(spoken)) return;

    sendChain = sendChain.then(async () => {
      try {
        await ready;
        if (failed || ws.readyState !== 1 || signal.aborted) return;
        ws.send(JSON.stringify({
          inputs: [{ text: spoken, voice_id: voiceId }],
        }));
      } catch {
        failed = true;
      }
    });
  };

  const finish = async () => {
    try {
      await sendChain;
      await ready;
      if (!failed && ws.readyState === 1 && !signal.aborted) {
        ws.send(JSON.stringify({ close_socket: true }));
        await Promise.race([
          finished,
          new Promise<void>((resolve) => setTimeout(resolve, 9000)),
        ]);
      }
    } catch {
      failed = true;
    } finally {
      try { if (ws.readyState === 0 || ws.readyState === 1) ws.close(); } catch {}
    }
    return { hadAudio, completed: hadAudio && finalAudio && !failed };
  };

  return {
    push,
    finish,
    close: () => {
      try { ws.close(); } catch {}
      settleFinished();
    },
  };
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });

  const raw = await request.text();
  if (raw.length > 2_400_000) return Response.json({ error: "이미지가 너무 커. 더 작은 사진으로 보내줘." }, { status: 413 });

  let messages: Message[];
  let wantVoice = true;
  let characterId: string | null = null;
  let voiceIdOverride: string | null = null;
  let requestedSleepModeUntil = 0;
  try {
    const parsed = JSON.parse(raw);
    messages = parsed.messages;
    wantVoice = parsed.voice !== false;
    characterId = typeof parsed.characterId === "string" && /^[a-f0-9-]{36}$/i.test(parsed.characterId) ? parsed.characterId : null;
    voiceIdOverride = typeof parsed.voiceId === "string" && /^[A-Za-z0-9]{20}$/.test(parsed.voiceId) ? parsed.voiceId : null;
    requestedSleepModeUntil = Number.isFinite(Number(parsed.sleepModeUntil)) ? Number(parsed.sleepModeUntil) : 0;
    const validImage = (value: unknown) => {
      if (!value || typeof value !== "object") return false;
      const image = value as { mimeType?: unknown; data?: unknown };
      if (!["image/jpeg", "image/png", "image/webp"].includes(String(image.mimeType || ""))) return false;
      if (typeof image.data !== "string" || image.data.length < 40 || image.data.length > 1_900_000) return false;
      return /^[A-Za-z0-9+/=]+$/.test(image.data);
    };
    if (!Array.isArray(messages) || !messages.length || messages.length > 24 ||
      !messages.every((m) => {
        if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || m.content.length > 1500) return false;
        if (m.image !== undefined && (m.role !== "user" || !validImage(m.image))) return false;
        return m.content.trim().length > 0 || !!m.image;
      }) ||
      messages.at(-1)?.role !== "user") throw Error();
  } catch {
    return Response.json({ error: "대화 기록을 확인해 줘." }, { status: 400 });
  }

  const character = await readLiveCharacter(characterId);
  if (!character) return Response.json({ error: "캐릭터 설정을 찾지 못했어." }, { status: 404 });

  const now = Date.now();
  const isDokyeong = character.name.trim() === "도경";
  const requestedSleepModeActive =
    isDokyeong &&
    requestedSleepModeUntil > now &&
    requestedSleepModeUntil <= now + SLEEP_MODE_MS + 60_000;
  const sleepModeUntil = requestedSleepModeActive
    ? requestedSleepModeUntil
    : isDokyeong && shouldStartSleepMode(messages)
      ? now + SLEEP_MODE_MS
      : 0;

  const sampleMessages = messages.map((m) => ({ role: m.role, content: m.content || (m.image ? "사진을 보냈어." : "") }));
  const sampleContext = await relatedSampleContext(sampleMessages, character.id, character.name);
  const prompt = character.prompt + (sleepModeUntil > now ? SLEEP_MODE_PROMPT : "") + sampleContext;
  const activeVoiceId = voiceIdOverride || character.voice_id;
  const result = await requestGemini(messages, prompt, request.signal);
  if (result.error) return result.error;
  const upstream = result.response!;
  const activeModel = result.model || liveConfig.gemini.responseModel;

  if (!upstream.ok || !upstream.body) {
    if (upstream.status === 401 || upstream.status === 403)
      return Response.json({ error: "Gemini API 키나 결제 설정을 확인해 줘." }, { status: 502 });
    if (upstream.status === 404)
      return Response.json({ error: "Gemini 모델을 사용할 수 없어. AI Studio 모델 권한을 확인해 줘." }, { status: 502 });
    if (upstream.status === 429)
      return Response.json({ error: "Gemini 사용 한도나 잔액을 확인해 줘." }, { status: 502 });
    return Response.json({ error: "Gemini 응답을 만들지 못했어." }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamOpen = true;
      const send = (event: object) => {
        if (!streamOpen) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch {}
      };
      const dialogue = wantVoice ? createDialogueBridge(send, request.signal, activeVoiceId) : null;
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let pending = "", spoken = "", full = "", lastError = false;
      let sentenceCount = 0, inTerminalRun = false, limitReached = false;

      const segment = (flush = false) => {
        while (spoken.length) {
          const boundary = spoken.search(/[.!?。！？]|[ㅋㅋㅎ]{2,}(?=\s|$)/);
          let end = boundary >= 0 ? boundary + 1 : -1;
          if (end >= 0 && spoken.length < 8 && !flush) break;
          if (end < 0 && spoken.length >= 34) {
            const splitAt = spoken.lastIndexOf(" ", 40);
            end = splitAt >= 22 ? splitAt + 1 : 34;
          }
          if (end <= 0 && flush) end = spoken.length;
          if (end <= 0) break;
          const part = spoken.slice(0, end).trim();
          spoken = spoken.slice(end).trimStart();
          if (part) send({ type: "segment", text: part });
        }
      };

      const emitText = (text: string) => {
        if (!text || limitReached) return;
        text = text.replace(/\s*\n+\s*/g, " ");

        let cut = text.length;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          const terminal = /[.!?。！？]/.test(ch);
          if (terminal) {
            if (!inTerminalRun) {
              sentenceCount++;
              inTerminalRun = true;
              if (sentenceCount >= 3) {
                let j = i + 1;
                while (j < text.length && /[.!?。！？]/.test(text[j])) j++;
                cut = j;
                limitReached = true;
                break;
              }
            }
          } else if (!/\s/.test(ch)) {
            inTerminalRun = false;
          }
        }

        const allowed = text.slice(0, cut);
        if (!allowed) return;
        full += allowed;
        spoken += allowed;
        send({ type: "delta", text: allowed });
        dialogue?.push(allowed);
        segment();
      };

      const processGeminiFrame = (frame: string) => {
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) return;
        try {
          const event = JSON.parse(data);
          const parts = event?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part?.thought === true) continue;
              if (typeof part?.text === "string") emitText(part.text);
            }
          }
          const finishReason = event?.candidates?.[0]?.finishReason;
          if (finishReason && !["STOP", "MAX_TOKENS"].includes(finishReason)) {
            lastError = true;
            send({ type: "error", message: "Gemini 응답 생성이 중단됐어." });
          }
        } catch {}
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
          let split: number;
          while ((split = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, split);
            pending = pending.slice(split + 2);
            processGeminiFrame(frame);
            if (limitReached) {
              await reader.cancel().catch(() => {});
              break;
            }
          }
          if (limitReached) break;
        }

        if (pending.trim() && !limitReached) processGeminiFrame(pending);

        if (!lastError || full.trim()) {
          segment(true);
          const completedText = full.trim();
          if (!completedText) {
            send({ type: "error", message: "답장을 만들지 못했어." });
          } else {
            // Commit text immediately. Audio must never hold the visible answer hostage.
            send({
              type: "text_done",
              text: completedText,
              provider: "gemini",
              model: activeModel,
            });

            let audioStatus = { hadAudio: false, completed: false };
            if (dialogue) audioStatus = await dialogue.finish();
            send({ type: audioStatus.completed ? "audio_done" : "audio_unavailable", hadAudio: audioStatus.hadAudio });

            send({
              type: "done",
              text: completedText,
              provider: "gemini",
              model: activeModel,
              audioModel: audioStatus.completed ? liveConfig.elevenlabs.dialogueModelId : null,
            });
          }
        }
      } catch {
        dialogue?.close();
        try { send({ type: "error", message: "연결이 끊겼어." }); } catch {}
      } finally {
        reader.releaseLock();
        streamOpen = false;
        try { controller.close(); } catch {}
      }
    },
    cancel() { upstream.body?.cancel().catch(() => {}); },
  });

  return new Response(stream, {
    headers: {
      ...noStore,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Dokyeong-Sleep-Until": String(sleepModeUntil),
    },
  });
}

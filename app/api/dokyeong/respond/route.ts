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
  try {
    const parsed = JSON.parse(raw);
    messages = parsed.messages;
    wantVoice = parsed.voice !== false;
    characterId = typeof parsed.characterId === "string" && /^[a-f0-9-]{36}$/i.test(parsed.characterId) ? parsed.characterId : null;
    voiceIdOverride = typeof parsed.voiceId === "string" && /^[A-Za-z0-9]{20}$/.test(parsed.voiceId) ? parsed.voiceId : null;
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
  const sampleMessages = messages.map((m) => ({ role: m.role, content: m.content || (m.image ? "사진을 보냈어." : "") }));
  const sampleContext = await relatedSampleContext(sampleMessages, character.id, character.name);
  const prompt = character.prompt + sampleContext;
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
    headers: { ...noStore, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

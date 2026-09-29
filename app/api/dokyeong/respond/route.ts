import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
import { activeCharacterPrompt } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

type Message = { role: "user" | "assistant"; content: string };
type DialogueBridge = {
  push: (text: string) => void;
  finish: () => Promise<void>;
  close: () => void;
};

function normalizeMessages(messages: Message[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
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

function createDialogueBridge(send: (event: object) => void, signal: AbortSignal): DialogueBridge | null {
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
        voices: [voice.voiceId],
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
          send({ type: "audio", data: message.audio, model: voice.dialogueModelId, format: voice.dialogueOutputFormat });
        }
        if (message.is_final_audio_for_turn === true || message.is_final === true) settleFinished();
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
          inputs: [{ text: spoken, voice_id: voice.voiceId }],
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
          new Promise<void>((resolve) => setTimeout(resolve, 16000)),
        ]);
      }
    } catch {
      // Text still returns normally; the client can fall back to the HTTP TTS route.
    } finally {
      try { if (ws.readyState === 0 || ws.readyState === 1) ws.close(); } catch {}
    }
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
  if (raw.length > 30_000) return Response.json({ error: "대화가 너무 길어." }, { status: 413 });

  let messages: Message[];
  let wantVoice = true;
  try {
    const parsed = JSON.parse(raw);
    messages = parsed.messages;
    wantVoice = parsed.voice !== false;
    if (!Array.isArray(messages) || !messages.length || messages.length > 24 ||
      !messages.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 1500) ||
      messages.at(-1)?.role !== "user") throw Error();
  } catch {
    return Response.json({ error: "대화 기록을 확인해 줘." }, { status: 400 });
  }

  const prompt = await activeCharacterPrompt();
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
      const dialogue = wantVoice ? createDialogueBridge(send, request.signal) : null;
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

        if (!lastError) {
          segment(true);
          if (dialogue) await dialogue.finish();
          send({
            type: "done",
            text: full.trim(),
            provider: "gemini",
            model: activeModel,
            audioModel: dialogue ? liveConfig.elevenlabs.dialogueModelId : null,
          });
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

import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { dokyeongPrompt, liveConfig } from "@/lib/dokyeong/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type Message = { role: "user" | "assistant"; content: string };
type Provider = "openai" | "gemini";

function normalizeMessages(messages: Message[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

async function requestOpenAI(messages: Message[], signal: AbortSignal) {
  if (!process.env.OPENAI_API_KEY) return { response: null, error: Response.json({ error: "OpenAI 연결 설정이 필요해." }, { status: 503 }) };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: liveConfig.openai.responseModel,
        instructions: dokyeongPrompt,
        input: messages,
        stream: true,
        max_output_tokens: 450,
        store: false,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
      cache: "no-store",
    });
    return { response, error: null };
  } catch {
    return { response: null, error: Response.json({ error: "GPT와 연결되지 않았어." }, { status: 502 }) };
  }
}

async function callGeminiModel(model: string, messages: Message[], signal: AbortSignal) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: dokyeongPrompt }] },
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

async function requestGemini(messages: Message[], signal: AbortSignal) {
  if (!process.env.GEMINI_API_KEY) return { response: null, error: Response.json({ error: "Gemini 연결 설정이 필요해." }, { status: 503 }), model: null };

  const primary = liveConfig.gemini.responseModel;
  const fallback = liveConfig.gemini.fallbackModel;
  try {
    let response = await callGeminiModel(primary, messages, signal);
    let model = primary;

    if ((response.status === 404 || response.status === 403) && fallback && fallback !== primary) {
      response.body?.cancel().catch(() => {});
      response = await callGeminiModel(fallback, messages, signal);
      model = fallback;
    }

    return { response, error: null, model };
  } catch {
    return { response: null, error: Response.json({ error: "Gemini와 연결되지 않았어." }, { status: 502 }), model: null };
  }
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });

  const raw = await request.text();
  if (raw.length > 30_000) return Response.json({ error: "대화가 너무 길어." }, { status: 413 });

  let messages: Message[];
  let provider: Provider = "gemini";
  try {
    const parsed = JSON.parse(raw);
    messages = parsed.messages;
    if (parsed.provider === "openai" || parsed.provider === "gemini") provider = parsed.provider;
    if (!Array.isArray(messages) || !messages.length || messages.length > 24 ||
      !messages.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 1500) ||
      messages.at(-1)?.role !== "user") throw Error();
  } catch {
    return Response.json({ error: "대화 기록을 확인해 줘." }, { status: 400 });
  }

  const result = provider === "gemini"
    ? await requestGemini(messages, request.signal)
    : { ...(await requestOpenAI(messages, request.signal)), model: liveConfig.openai.responseModel };
  if (result.error) return result.error;
  const upstream = result.response!;
  const activeModel = result.model || (provider === "gemini" ? liveConfig.gemini.responseModel : liveConfig.openai.responseModel);

  if (!upstream.ok || !upstream.body) {
    if (provider === "gemini") {
      if (upstream.status === 401 || upstream.status === 403)
        return Response.json({ error: "Gemini API 키나 결제 설정을 확인해 줘." }, { status: 502 });
      if (upstream.status === 404)
        return Response.json({ error: "Gemini 모델을 사용할 수 없어. AI Studio 모델 권한을 확인해 줘." }, { status: 502 });
      if (upstream.status === 429)
        return Response.json({ error: "Gemini 사용 한도나 잔액을 확인해 줘." }, { status: 502 });
      return Response.json({ error: "Gemini 응답을 만들지 못했어." }, { status: 502 });
    }
    return Response.json({ error: upstream.status === 401 ? "OpenAI API 키를 확인해 줘." : "GPT 응답을 만들지 못했어." }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let pending = "", spoken = "", full = "", lastError = false;

      const segment = (flush = false) => {
        while (spoken.length) {
          const boundary = spoken.search(/[.!?。！？\n]|[ㅋㅋㅎ]{2,}(?=\s|$)/);
          let end = boundary >= 0 ? boundary + 1 : -1;
          if (end >= 0 && spoken.length < 8 && !flush) break;
          if (end < 0 && spoken.length >= 58) end = spoken.lastIndexOf(" ", 62) + 1;
          if (end <= 0 && flush) end = spoken.length;
          if (end <= 0) break;
          const part = spoken.slice(0, end).trim();
          spoken = spoken.slice(end).trimStart();
          if (part) send({ type: "segment", text: part });
        }
      };

      const emitText = (text: string) => {
        if (!text) return;
        full += text;
        spoken += text;
        send({ type: "delta", text });
        segment();
      };

      const processOpenAIFrame = (frame: string) => {
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") return;
        try {
          const event = JSON.parse(data);
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") emitText(event.delta);
          if (event.type === "response.failed" || event.type === "error") {
            lastError = true;
            send({ type: "error", message: "GPT 응답 생성이 중단됐어." });
          }
        } catch {}
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
            if (provider === "gemini") processGeminiFrame(frame);
            else processOpenAIFrame(frame);
          }
        }
        if (pending.trim()) {
          if (provider === "gemini") processGeminiFrame(pending);
          else processOpenAIFrame(pending);
        }
        if (!lastError) {
          segment(true);
          send({ type: "done", text: full.trim(), provider, model: activeModel });
        }
      } catch {
        try { send({ type: "error", message: "연결이 끊겼어." }); } catch {}
      } finally {
        reader.releaseLock();
        try { controller.close(); } catch {}
      }
    },
    cancel() { upstream.body?.cancel().catch(() => {}); },
  });

  return new Response(stream, {
    headers: { ...noStore, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

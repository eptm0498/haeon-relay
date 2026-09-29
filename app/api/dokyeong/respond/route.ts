import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { dokyeongPrompt, liveConfig } from "@/lib/dokyeong/config";
export const runtime = "nodejs";
export const maxDuration = 60;
type Message = { role: "user" | "assistant"; content: string };

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "OpenAI 연결 설정이 필요해." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 30_000) return Response.json({ error: "대화가 너무 길어." }, { status: 413 });
  let messages: Message[];
  try {
    const parsed = JSON.parse(raw);
    messages = parsed.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 24 ||
      !messages.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 1500) ||
      messages.at(-1)?.role !== "user") throw Error();
  } catch { return Response.json({ error: "대화 기록을 확인해 줘." }, { status: 400 }); }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: liveConfig.openai.responseModel, instructions: dokyeongPrompt,
        input: messages, stream: true, max_output_tokens: 450, store: false }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(55000)]), cache: "no-store",
    });
  } catch { return Response.json({ error: "도경이랑 연결되지 않았어." }, { status: 502 }); }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: upstream.status === 401 ? "OpenAI API 키를 확인해 줘." : "응답을 만들지 못했어." }, { status: 502 });
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
          const part = spoken.slice(0, end).trim(); spoken = spoken.slice(end).trimStart();
          if (part) send({ type: "segment", text: part });
        }
      };
      const processFrame = (frame: string) => {
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") return;
        try {
          const event = JSON.parse(data);
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            full += event.delta; spoken += event.delta; send({ type: "delta", text: event.delta }); segment();
          }
          if (event.type === "response.failed" || event.type === "error") {
            lastError = true; send({ type: "error", message: "응답 생성이 중단됐어." });
          }
        } catch { /* A malformed upstream event is not a user-facing message. */ }
      };
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
          let split: number;
          while ((split = pending.indexOf("\n\n")) >= 0) { processFrame(pending.slice(0, split)); pending = pending.slice(split + 2); }
        }
        if (pending.trim()) processFrame(pending);
        if (!lastError) { segment(true); send({ type: "done", text: full.trim() }); }
      } catch { try { send({ type: "error", message: "연결이 끊겼어." }); } catch {} }
      finally { reader.releaseLock(); try { controller.close(); } catch {} }
    },
    cancel() { upstream.body?.cancel().catch(() => {}); },
  });
  return new Response(stream, { headers: { ...noStore, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

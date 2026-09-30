import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";

export const runtime = "nodejs";
export const maxDuration = 30;

function makeForm(file: File, model: string) {
  const form = new FormData();
  const extension = file.type.includes("mp4") ? "mp4" : file.type.includes("ogg") ? "ogg" : file.type.includes("wav") ? "wav" : file.type.includes("mpeg") ? "mp3" : "webm";
  form.append("file", file, `speech.${extension}`);
  form.append("model", model);
  form.append("language", "ko");
  return form;
}

async function transcribe(file: File, model: string, signal: AbortSignal, timeoutMs: number) {
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: makeForm(file, model),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    cache: "no-store",
  });
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "OpenAI 연결 설정이 필요해." }, { status: 503 });

  const input = await request.formData().catch(() => null);
  const file = input?.get("audio");
  if (!(file instanceof File) || file.size < 1000 || file.size > 6_000_000 || !/^audio\/(mp4|webm|ogg|mpeg|wav|x-m4a)/.test(file.type))
    return Response.json({ error: "녹음 형식을 확인해 줘." }, { status: 400 });

  const primary = liveConfig.openai.transcriptionModel;
  const fallback = "gpt-4o-mini-transcribe";

  try {
    let upstream = await transcribe(file, primary, request.signal, 15000);
    let model = primary;

    if (!upstream.ok && primary !== fallback && [400, 403, 404, 422, 500, 502, 503].includes(upstream.status)) {
      const primaryError = await upstream.text().catch(() => "");
      console.warn("[dokyeong/transcribe] primary failed", { status: upstream.status, model: primary, detail: primaryError.slice(0, 500) });
      upstream = await transcribe(file, fallback, request.signal, 12000);
      model = fallback;
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.warn("[dokyeong/transcribe] failed", { status: upstream.status, model, detail: detail.slice(0, 500), type: file.type, size: file.size });
      if (upstream.status === 401) return Response.json({ error: "음성 인식 API 인증을 확인해 줘." }, { status: 502, headers: noStore });
      if (upstream.status === 429) return Response.json({ error: "음성 인식 사용 한도나 잔액을 확인해 줘." }, { status: 502, headers: noStore });
      return Response.json({ error: "음성을 인식하지 못했어. 다시 말해줘." }, { status: 502, headers: noStore });
    }

    const result = await upstream.json();
    return Response.json({ text: String(result.text || "").trim().slice(0, 1500), model }, { headers: noStore });
  } catch (error) {
    console.warn("[dokyeong/transcribe] connection error", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "음성 인식 연결이 끊겼어." }, { status: 502, headers: noStore });
  }
}

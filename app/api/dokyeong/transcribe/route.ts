import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "OpenAI 연결 설정이 필요해." }, { status: 503 });
  const input = await request.formData().catch(() => null);
  const file = input?.get("audio");
  if (!(file instanceof File) || file.size < 1000 || file.size > 6_000_000 || !/^audio\/(mp4|webm|ogg|mpeg|wav|x-m4a)/.test(file.type))
    return Response.json({ error: "녹음 형식을 확인해 줘." }, { status: 400 });
  const form = new FormData();
  const extension = file.type.includes("mp4") ? "mp4" : file.type.includes("ogg") ? "ogg" : file.type.includes("wav") ? "wav" : "webm";
  form.append("file", file, `speech.${extension}`);
  form.append("model", liveConfig.openai.transcriptionModel);
  form.append("language", "ko");
  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]), cache: "no-store",
    });
    if (!upstream.ok) return Response.json({ error: "음성을 인식하지 못했어. 다시 말해줘." }, { status: 502, headers: noStore });
    const result = await upstream.json();
    return Response.json({ text: String(result.text || "").trim().slice(0, 1500) }, { headers: noStore });
  } catch { return Response.json({ error: "음성 인식 연결이 끊겼어." }, { status: 502, headers: noStore }); }
}

import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
export const runtime = "nodejs";
export const maxDuration = 40;

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "ElevenLabs 연결 설정이 필요해." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 1800) return Response.json({ error: "발화가 너무 길어." }, { status: 413 });
  let text = "";
  try { text = String(JSON.parse(raw).text || "").trim(); } catch {}
  if (!text || text.length > 400) return Response.json({ error: "발화 길이를 확인해 줘." }, { status: 400 });
  const voice = liveConfig.elevenlabs;
  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/stream?output_format=mp3_22050_32`, {
      method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: voice.modelId, language_code: "ko",
        voice_settings: { stability: voice.stability, similarity_boost: voice.similarityBoost, style: voice.style, speed: voice.speed } }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(35000)]), cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) return Response.json({ error: "도경 목소리를 만들지 못했어." }, { status: 502 });
    return new Response(upstream.body, { headers: { ...noStore, "Content-Type": "audio/mpeg", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "음성 연결이 끊겼어." }, { status: 502 }); }
}

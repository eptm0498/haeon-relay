import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
export const runtime = "nodejs";
export const maxDuration = 40;

async function callElevenLabs(text: string, modelId: string, signal: AbortSignal, timeoutMs: number) {
  const voice = liveConfig.elevenlabs;
  const classicVoiceSettings = modelId !== "eleven_v3" && !modelId.startsWith("eleven_v4");

  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/stream?output_format=${encodeURIComponent(voice.outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        language_code: "ko",
        ...(classicVoiceSettings ? {
          voice_settings: {
            stability: voice.stability,
            similarity_boost: voice.similarityBoost,
            style: voice.style,
            speed: voice.speed,
            use_speaker_boost: true,
          },
        } : {}),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      cache: "no-store",
    }
  );
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "ElevenLabs 연결 설정이 필요해." }, { status: 503 });

  const raw = await request.text();
  if (raw.length > 5000) return Response.json({ error: "발화가 너무 길어." }, { status: 413 });

  let text = "";
  try { text = String(JSON.parse(raw).text || "").trim(); } catch {}
  if (!text || text.length > 1400) return Response.json({ error: "발화 길이를 확인해 줘." }, { status: 400 });

  const voice = liveConfig.elevenlabs;
  let activeModel = voice.modelId;

  try {
    let upstream: Response;
    try {
      upstream = await callElevenLabs(text, activeModel, request.signal, 18000);
    } catch (primaryError) {
      if (request.signal.aborted || activeModel === voice.fallbackModelId) throw primaryError;
      activeModel = voice.fallbackModelId;
      upstream = await callElevenLabs(text, activeModel, request.signal, 14000);
    }

    if (!upstream.ok && activeModel !== voice.fallbackModelId && upstream.status !== 401) {
      upstream.body?.cancel().catch(() => {});
      activeModel = voice.fallbackModelId;
      upstream = await callElevenLabs(text, activeModel, request.signal, 14000);
    }

    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "도경 목소리를 만들지 못했어." }, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        ...noStore,
        "Content-Type": "audio/mpeg",
        "X-Content-Type-Options": "nosniff",
        "X-Dokyeong-TTS-Model": activeModel,
      },
    });
  } catch {
    return Response.json({ error: "목소리 생성에 실패했어." }, { status: 502 });
  }
}

import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
import { readLiveCharacter } from "@/lib/dokyeong/characters";

export const runtime = "nodejs";
export const maxDuration = 40;

async function callDialogue(text: string, voiceId: string, signal: AbortSignal, timeoutMs: number) {
  const voice = liveConfig.elevenlabs;
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=${encodeURIComponent(voice.outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: voice.dialogueModelId,
        inputs: [{ text, voice_id: voiceId }],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      cache: "no-store",
    }
  );
}

async function callFlash(text: string, voiceId: string, signal: AbortSignal, timeoutMs: number) {
  const voice = liveConfig.elevenlabs;
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(voice.outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: voice.fallbackModelId,
        language_code: "ko",
        voice_settings: {
          stability: voice.stability,
          similarity_boost: voice.similarityBoost,
          style: voice.style,
          speed: voice.speed,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      cache: "no-store",
    }
  );
}

async function describeFailure(response: Response) {
  const detail = await response.text().catch(() => "");
  return { status: response.status, detail: detail.slice(0, 600) };
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "ElevenLabs 연결 설정이 필요해." }, { status: 503 });

  const raw = await request.text();
  if (raw.length > 5000) return Response.json({ error: "발화가 너무 길어." }, { status: 413 });

  let text = "";
  let characterId: string | null = null;
  try {
    const body = JSON.parse(raw);
    text = String(body.text || "").trim();
    characterId = typeof body.characterId === "string" && /^[a-f0-9-]{36}$/i.test(body.characterId) ? body.characterId : null;
  } catch {}
  if (!text || text.length > 1400) return Response.json({ error: "발화 길이를 확인해 줘." }, { status: 400 });

  const character = await readLiveCharacter(characterId);
  if (!character) return Response.json({ error: "캐릭터 설정을 찾지 못했어." }, { status: 404 });
  const voice = liveConfig.elevenlabs;
  const voiceId = character.voice_id;

  try {
    try {
      const dialogue = await callDialogue(text, voiceId, request.signal, 18000);
      if (dialogue.ok && dialogue.body) {
        return new Response(dialogue.body, {
          headers: {
            ...noStore,
            "Content-Type": "audio/mpeg",
            "X-Content-Type-Options": "nosniff",
            "X-Dokyeong-TTS-Model": voice.dialogueModelId,
          },
        });
      }
      console.warn("[dokyeong/tts] dialogue failed", await describeFailure(dialogue));
    } catch (error) {
      if (request.signal.aborted) throw error;
      console.warn("[dokyeong/tts] dialogue connection failed", error instanceof Error ? error.message : "unknown");
    }

    // Reliable low-latency fallback. Retry once because transient ElevenLabs 5xx errors do occur.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const fallback = await callFlash(text, voiceId, request.signal, attempt === 1 ? 14000 : 10000);
        if (fallback.ok && fallback.body) {
          return new Response(fallback.body, {
            headers: {
              ...noStore,
              "Content-Type": "audio/mpeg",
              "X-Content-Type-Options": "nosniff",
              "X-Dokyeong-TTS-Model": voice.fallbackModelId,
            },
          });
        }
        console.warn("[dokyeong/tts] flash failed", { attempt, ...(await describeFailure(fallback)) });
        if (fallback.status === 401 || fallback.status === 429) break;
      } catch (error) {
        if (request.signal.aborted) throw error;
        console.warn("[dokyeong/tts] flash connection failed", { attempt, detail: error instanceof Error ? error.message : "unknown" });
      }
    }

    return Response.json({ error: "도경 목소리를 만들지 못했어." }, { status: 502, headers: noStore });
  } catch {
    return Response.json({ error: "목소리 생성에 실패했어." }, { status: 502, headers: noStore });
  }
}

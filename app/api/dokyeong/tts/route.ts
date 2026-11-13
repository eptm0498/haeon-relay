import {isProjectCharacter,spokenDialogue} from "@/lib/dokyeong/project-dialogue";
import { isVoiceOnlyCharacter } from "@/lib/dokyeong/character-modes";
import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
import { httpSpeechModel, liveModelOverrides, realtimeSpeechModel } from "@/lib/dokyeong/model-settings";
import { readLiveCharacter } from "@/lib/dokyeong/characters";
import { voiceFailure, type VoiceFailure } from "@/lib/dokyeong/voice-failure";

export const runtime = "nodejs";
export const maxDuration = 40;

async function callDialogue(text: string, voiceId: string, model: string, signal: AbortSignal, timeoutMs: number) {
  const voice = liveConfig.elevenlabs;
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=${encodeURIComponent(voice.outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: model,
        inputs: [{ text, voice_id: voiceId }],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      cache: "no-store",
    }
  );
}

async function callSpeech(text: string, voiceId: string, model: string, signal: AbortSignal, timeoutMs: number) {
  const voice = liveConfig.elevenlabs;
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(voice.outputFormat)}`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: model,
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
  return voiceFailure(await response.json().catch(()=>null),response.status);
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "ElevenLabs 연결 설정이 필요해." }, { status: 503 });

  const raw = await request.text();
  if (raw.length > 5000) return Response.json({ error: "발화가 너무 길어." }, { status: 413 });

  let text = "";
  let characterId: string | null = null;
  let voiceIdOverride: string | null = null;
  try {
    const body = JSON.parse(raw);
    text = String(body.text || "").trim();
    characterId = typeof body.characterId === "string" && /^[a-f0-9-]{36}$/i.test(body.characterId) ? body.characterId : null;
    voiceIdOverride = typeof body.voiceId === "string" && /^[A-Za-z0-9]{20}$/.test(body.voiceId) ? body.voiceId : null;
  } catch {}
  if (!text || text.length > 1400) return Response.json({ error: "발화 길이를 확인해 줘." }, { status: 400 });

  const character = await readLiveCharacter(characterId);
  if (!character) return Response.json({ error: "캐릭터 설정을 찾지 못했어." }, { status: 404 });
  text=(isProjectCharacter(character)||isVoiceOnlyCharacter(character.id))?spokenDialogue(text):text.replace(/[ㅋㅎㅠㅜ]+/g," ").trim();
  if(!text)return Response.json({error:"읽을 대사가 없어."},{status:400,headers:noStore});
  const voiceId = voiceIdOverride || character.voice_id;
  const { speechModel } = await liveModelOverrides(request.signal);
  const primary = httpSpeechModel(speechModel);
  const flash = liveConfig.elevenlabs.fallbackModelId;
  const dialogue = primary === "eleven_v3" || primary === "eleven_v4";
  const attempts = dialogue
    ? [{ model: primary, timeout: 18000 }, ...(realtimeSpeechModel(speechModel)
      ? [{ model: flash, timeout: 10000 }, { model: flash, timeout: 7000 }]
      : [{ model: primary, timeout: 14000 }])]
    : [{ model: primary, timeout: 18000 }, { model: primary, timeout: 12000 }];
  let failure: VoiceFailure = voiceFailure({ code: "voice_unavailable" });

  for (const { model, timeout } of attempts) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers: noStore });
    try {
      const generate = model === "eleven_v3" || model === "eleven_v4" ? callDialogue : callSpeech;
      const result = await generate(text, voiceId, model, request.signal, timeout);
      if (result.ok && result.body) {
        return new Response(result.body, {
          headers: {
            ...noStore,
            "Content-Type": "audio/mpeg",
            "X-Content-Type-Options": "nosniff",
            "X-Dokyeong-TTS-Model": model,
          },
        });
      }
      failure = await describeFailure(result);
      console.warn("[dokyeong/tts] synthesis failed", { model, status: result.status, code: failure.code });
      if (failure.terminal || result.status === 429) break;
    } catch {
      if (request.signal.aborted) return new Response(null, { status: 499, headers: noStore });
      console.warn("[dokyeong/tts] synthesis connection failed", { model });
    }
  }

  return Response.json({ error: failure.message, code: failure.code }, { status: 503, headers: noStore });
}

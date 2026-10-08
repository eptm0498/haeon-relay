import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
import { readLiveCharacter } from "@/lib/dokyeong/characters";
import { voiceFailure, type VoiceFailure } from "@/lib/dokyeong/voice-failure";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  return voiceFailure(await response.json().catch(()=>null),response.status);
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!process.env.ELEVENLABS_API_KEY && !process.env.OPENAI_API_KEY) return Response.json({ error: "음성 연결 설정이 필요해." }, { status: 503 });

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
  const voice = liveConfig.elevenlabs;
  const voiceId = voiceIdOverride || character.voice_id;
  let failure:VoiceFailure=voiceFailure({code:'voice_unavailable'});

  try {
    if(process.env.ELEVENLABS_API_KEY){
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
      failure=await describeFailure(dialogue);
      console.warn("[dokyeong/tts] dialogue failed", {status:dialogue.status,code:failure.code});
    } catch (error) {
      if (request.signal.aborted) throw error;
      console.warn("[dokyeong/tts] dialogue connection failed");
    }

    // Reliable low-latency fallback. Retry once because transient ElevenLabs 5xx errors do occur.
    for (let attempt = 1; !failure.terminal && attempt <= 2; attempt++) {
      try {
        const fallback = await callFlash(text, voiceId, request.signal, attempt === 1 ? 10000 : 7000);
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
        failure=await describeFailure(fallback);
        console.warn("[dokyeong/tts] flash failed", {attempt,status:fallback.status,code:failure.code});
        if (failure.terminal || fallback.status === 429) break;
      } catch (error) {
        if (request.signal.aborted) throw error;
        console.warn("[dokyeong/tts] flash connection failed", { attempt });
      }
    }
    }
    // Keep the saved character voice. Use a clearly labelled backup only while
    // the preferred provider is unavailable, and try the preferred voice next time.
    if(process.env.OPENAI_API_KEY&&!request.signal.aborted){
      const backup=await fetch('https://api.openai.com/v1/audio/speech',{
        method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'ash',input:text,response_format:'mp3',instructions:'한국어 표준어로 자연스럽게 말해. 젊은 성인 남성의 편안하고 다정한 일상 대화 톤. 입력 문장만 읽고 내용을 추가하거나 바꾸지 마.'}),
        signal:AbortSignal.any([request.signal,AbortSignal.timeout(18000)]),cache:'no-store'
      });
      if(backup.ok&&backup.body)return new Response(backup.body,{headers:{...noStore,'Content-Type':'audio/mpeg','X-Content-Type-Options':'nosniff','X-Dokyeong-TTS-Model':'gpt-4o-mini-tts','X-Dokyeong-TTS-Provider':'openai','X-Dokyeong-TTS-Fallback':failure.code}});
      console.warn('[dokyeong/tts] backup failed',{status:backup.status});
    }

    return Response.json({ error: failure.message+' 임시 음성도 연결되지 않았어.',code:failure.code }, { status: 503, headers: noStore });
  } catch {
    return Response.json({ error: failure.message,code:failure.code }, { status: 502, headers: noStore });
  }
}

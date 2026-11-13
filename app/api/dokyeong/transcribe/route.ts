import type { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
import { liveModelOverrides } from "@/lib/dokyeong/model-settings";

export const runtime = "nodejs";
export const maxDuration = 30;

const audioExtensions: Record<string, string> = {
  "audio/wav": "wav",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
};

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: noStore });
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return failure("요청을 확인해 줘.", 403);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return failure("일레븐랩스 음성 인식 연결 설정을 확인해 줘.", 503);

  const input = await request.formData().catch(() => null);
  const file = input?.get("audio");
  const extension = file instanceof File ? audioExtensions[file.type.split(";")[0].trim()] : "";
  if (!(file instanceof File) || !extension || file.size < 1000 || file.size > 6_000_000) {
    return failure("녹음 형식을 확인해 줘.", 400);
  }

  const { transcriptionModel } = await liveModelOverrides(request.signal);
  const model = transcriptionModel ?? liveConfig.elevenlabs.transcriptionModelId;
  const form = new FormData();
  form.append("file", file, `speech.${extension}`);
  form.append("model_id", model);
  form.append("language_code", "ko");
  form.append("tag_audio_events", "false");
  form.append("timestamps_granularity", "none");

  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      cache: "no-store",
    });
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      console.warn("[dokyeong/transcribe] Scribe request failed", { status: upstream.status, model });
      if (upstream.status === 401 || upstream.status === 403) return failure("일레븐랩스 음성 인식 API 권한을 확인해 줘.", 502);
      if (upstream.status === 402 || upstream.status === 429) return failure("일레븐랩스 음성 인식 사용 한도나 잔액을 확인해 줘.", 502);
      return failure("음성을 인식하지 못했어. 다시 말해줘.", 502);
    }

    const result = await upstream.json();
    if (typeof result?.text !== "string") return failure("음성 인식 결과를 받지 못했어.", 502);
    return Response.json({ text: result.text.trim().slice(0, 1500), model }, { headers: noStore });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers: noStore });
    console.warn("[dokyeong/transcribe] connection error", { model, error: error instanceof Error ? error.name : "unknown" });
    return failure("음성 인식 연결이 끊겼어.", 502);
  }
}

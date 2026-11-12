import { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";

export const runtime = "nodejs";
export const maxDuration = 30;

const characterNames = new Set(["도경", "주운", "온유", "두리", "지우"]);

function makeForm(file: File, model: string, characterName: string) {
  const form = new FormData();
  const extension = file.type.includes("mp4") ? "mp4" : file.type.includes("ogg") ? "ogg" : file.type.includes("wav") ? "wav" : file.type.includes("mpeg") ? "mp3" : "webm";
  form.append("file", file, `speech.${extension}`);
  form.append("model", model);
  const prompt = "한국어 일상 통화의 받아쓰기. 들리는 말만 그대로 옮긴다. 짧은 맞장구와 반말을 살리고, 배경음이나 불명확한 말은 추측하지 않는다.";
  if (/^gpt-transcribe(?:-|$)/.test(model)) {
    form.append("languages[]", "ko");
    if (characterName) form.append("keywords[]", characterName);
    form.append("prompt", prompt);
  } else {
    form.append("language", "ko");
    if (model !== "gpt-4o-transcribe-diarize") form.append("prompt", prompt + (characterName ? ` 등장할 수 있는 이름: ${characterName}.` : ""));
  }
  return form;
}

async function transcribe(file: File, model: string, signal: AbortSignal, timeoutMs: number, characterName: string) {
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: makeForm(file, model, characterName),
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

  const hint = input?.get("characterName");
  const characterName = typeof hint === "string" && characterNames.has(hint) ? hint : "";
  const primary = liveConfig.openai.transcriptionModel;
  const fallback = "gpt-4o-mini-transcribe";

  try {
    let upstream = await transcribe(file, primary, request.signal, 15000, characterName);
    let model = primary;

    if (!upstream.ok && primary !== fallback && [400, 403, 404, 422, 500, 502, 503].includes(upstream.status)) {
      void upstream.body?.cancel().catch(() => {});
      console.warn("[dokyeong/transcribe] primary failed", { status: upstream.status, model: primary });
      upstream = await transcribe(file, fallback, request.signal, 12000, characterName);
      model = fallback;
    }

    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      console.warn("[dokyeong/transcribe] failed", { status: upstream.status, model, type: file.type, size: file.size });
      if (upstream.status === 401) return Response.json({ error: "음성 인식 API 인증을 확인해 줘." }, { status: 502, headers: noStore });
      if (upstream.status === 429) return Response.json({ error: "음성 인식 사용 한도나 잔액을 확인해 줘." }, { status: 502, headers: noStore });
      return Response.json({ error: "음성을 인식하지 못했어. 다시 말해줘." }, { status: 502, headers: noStore });
    }

    const result = await upstream.json();
    return Response.json({ text: String(result.text || "").trim().slice(0, 1500), model }, { headers: noStore });
  } catch (error) {
    console.warn("[dokyeong/transcribe] connection error", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "음성 인식 연결이 끊겼어." }, { status: 502, headers: noStore });
  }
}

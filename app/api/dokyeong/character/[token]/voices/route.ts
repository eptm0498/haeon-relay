import { NextRequest } from "next/server";
import { noStore } from "@/lib/dokyeong/auth";
import { verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });
    if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "ElevenLabs 연결 설정이 필요해." }, { status: 503, headers: noStore });

    const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=true", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn("[dokyeong/voices] ElevenLabs failed", response.status, detail.slice(0, 400));
      return Response.json({ error: "ElevenLabs 목소리를 불러오지 못했어." }, { status: 502, headers: noStore });
    }
    const data = await response.json();
    const voices = Array.isArray(data.voices) ? data.voices.map((voice: any) => ({
      voice_id: String(voice.voice_id || ""),
      name: String(voice.name || "이름 없는 목소리"),
      category: String(voice.category || ""),
      description: String(voice.description || ""),
      preview_url: typeof voice.preview_url === "string" ? voice.preview_url : null,
      labels: voice.labels && typeof voice.labels === "object" ? voice.labels : {},
      is_owner: voice.is_owner !== false,
    })).filter((voice: any) => voice.voice_id && voice.category !== "premade") : [];
    return Response.json({ voices }, { headers: noStore });
  } catch {
    return Response.json({ error: "ElevenLabs 목소리를 불러오지 못했어." }, { status: 503, headers: noStore });
  }
}

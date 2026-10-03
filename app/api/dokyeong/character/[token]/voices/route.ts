import { NextRequest } from "next/server";
import { noStore } from "@/lib/dokyeong/auth";
import { verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };

const fallbackVoices = [
  { voice_id:"heIt0WXN96T1EYYZ3rxA", name:"글루", category:"cloned", description:"1", preview_url:null, labels:{language:"ko"}, is_owner:true },
  { voice_id:"peTGXjUdPy5VJNYTcdea", name:"도경", category:"cloned", description:"도경1", preview_url:null, labels:{language:"ko"}, is_owner:true },
  { voice_id:"rRzJ2jwUxhnEVwa36A3h", name:"반일", category:"cloned", description:"1111", preview_url:null, labels:{language:"ko"}, is_owner:true },
  { voice_id:"liHUf9OCL2A4bg7dkKQY", name:"승", category:"cloned", description:"승", preview_url:null, labels:{language:"ko"}, is_owner:true },
  { voice_id:"xQ8johhwasREngMvEpzm", name:"온아", category:"cloned", description:"111", preview_url:null, labels:{language:"ko"}, is_owner:true },
  { voice_id:"9rZOpKhfmFa6UIvpEi4C", name:"JunHyuk", category:"professional", description:"Korean voice created by a professional voice actor.", preview_url:null, labels:{language:"ko",gender:"male",accent:"seoul"}, is_owner:true },
  { voice_id:"JsyP5NIpAZhfPw5mwSP0", name:"Kyung Hoon - Calm & Natural", category:"professional", description:"Natural voice of a Korean male in his 20s.", preview_url:null, labels:{language:"ko",gender:"male",accent:"seoul"}, is_owner:true },
  { voice_id:"fLvpMIGwcTmxzsUF4z1U", name:"kwak", category:"professional", description:"한국인 남자 목소리로 낮고 편안한 목소리.", preview_url:null, labels:{language:"ko",gender:"male",accent:"standard"}, is_owner:true },
];

export async function GET(_request: NextRequest, { params }: Context) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });
    if (!process.env.ELEVENLABS_API_KEY)
      return Response.json({ voices: fallbackVoices, source: "synced" }, { headers: noStore });

    const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=true", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (response.ok) {
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

      const merged = [...voices];
      for (const fallback of fallbackVoices) if (!merged.some((voice: any) => voice.voice_id === fallback.voice_id)) merged.push(fallback);
      return Response.json({ voices: merged, source: "live" }, { headers: noStore });
    }

    const detail = await response.text().catch(() => "");
    console.warn("[dokyeong/voices] ElevenLabs read unavailable; using synced list", response.status, detail.slice(0, 400));
    return Response.json({ voices: fallbackVoices, source: "synced" }, { headers: noStore });
  } catch (error) {
    console.warn("[dokyeong/voices] voice listing failed; using synced list", error instanceof Error ? error.message : "unknown");
    return Response.json({ voices: fallbackVoices, source: "synced" }, { headers: noStore });
  }
}

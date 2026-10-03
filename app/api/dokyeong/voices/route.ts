import { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";

export const runtime = "nodejs";

const fallbackVoices = [
  { voice_id:"heIt0WXN96T1EYYZ3rxA", name:"글루", category:"cloned", labels:{language:"ko"} },
  { voice_id:"peTGXjUdPy5VJNYTcdea", name:"도경", category:"cloned", labels:{language:"ko"} },
  { voice_id:"rRzJ2jwUxhnEVwa36A3h", name:"반일", category:"cloned", labels:{language:"ko"} },
  { voice_id:"liHUf9OCL2A4bg7dkKQY", name:"승", category:"cloned", labels:{language:"ko"} },
  { voice_id:"xQ8johhwasREngMvEpzm", name:"온아", category:"cloned", labels:{language:"ko"} },
  { voice_id:"9rZOpKhfmFa6UIvpEi4C", name:"JunHyuk", category:"professional", labels:{language:"ko",gender:"male",accent:"seoul"} },
  { voice_id:"JsyP5NIpAZhfPw5mwSP0", name:"Kyung Hoon - Calm & Natural", category:"professional", labels:{language:"ko",gender:"male",accent:"seoul"} },
  { voice_id:"fLvpMIGwcTmxzsUF4z1U", name:"kwak", category:"professional", labels:{language:"ko",gender:"male",accent:"standard"} },
];

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!process.env.ELEVENLABS_API_KEY) {
    return Response.json({ voices: fallbackVoices, source: "synced" }, { headers: noStore });
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=true", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return Response.json({ voices: fallbackVoices, source: "synced" }, { headers: noStore });
    }

    const data = await response.json();
    const voices = Array.isArray(data.voices)
      ? data.voices.map((voice: any) => ({
          voice_id: String(voice.voice_id || ""),
          name: String(voice.name || "이름 없는 목소리"),
          category: String(voice.category || ""),
          labels: voice.labels && typeof voice.labels === "object" ? voice.labels : {},
        })).filter((voice: any) => voice.voice_id && voice.category !== "premade")
      : [];

    const merged = [...voices];
    for (const fallback of fallbackVoices) {
      if (!merged.some((voice: any) => voice.voice_id === fallback.voice_id)) merged.push(fallback);
    }

    merged.sort((a: any, b: any) => {
      const ak = a.category === "cloned" ? 0 : a.labels?.language === "ko" ? 1 : 2;
      const bk = b.category === "cloned" ? 0 : b.labels?.language === "ko" ? 1 : 2;
      return ak - bk || a.name.localeCompare(b.name, "ko");
    });

    return Response.json({ voices: merged, source: "live" }, { headers: noStore });
  } catch {
    return Response.json({ voices: fallbackVoices, source: "synced" }, { headers: noStore });
  }
}

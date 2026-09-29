import { NextRequest } from "next/server";
import { authenticated, configured, noStore } from "@/lib/dokyeong/auth";
import { liveConfig } from "@/lib/dokyeong/config";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = authenticated(request);
  const openai = !!process.env.OPENAI_API_KEY;
  const gemini = !!process.env.GEMINI_API_KEY;
  const elevenlabs = !!process.env.ELEVENLABS_API_KEY;
  return Response.json({
    configured: configured(),
    authenticated: auth,
    ready: auth && openai && gemini && elevenlabs,
    providers: { openai, gemini, elevenlabs },
    audio: { ttsModel: liveConfig.elevenlabs.modelId, dialogueModel: liveConfig.elevenlabs.dialogueModelId, outputFormat: liveConfig.elevenlabs.outputFormat },
    missing: auth
      ? [!openai && "OPENAI_API_KEY", !gemini && "GEMINI_API_KEY", !elevenlabs && "ELEVENLABS_API_KEY"].filter(Boolean)
      : [],
  }, { headers: noStore });
}

import { NextRequest } from "next/server";
import { authenticated, configured, noStore } from "@/lib/dokyeong/auth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return Response.json({
    configured: configured(), authenticated: authenticated(request),
    ready: authenticated(request) && !!process.env.OPENAI_API_KEY && !!process.env.ELEVENLABS_API_KEY,
    missing: authenticated(request) ? [!process.env.OPENAI_API_KEY && "OPENAI_API_KEY", !process.env.ELEVENLABS_API_KEY && "ELEVENLABS_API_KEY"].filter(Boolean) : [],
  }, { headers: noStore });
}

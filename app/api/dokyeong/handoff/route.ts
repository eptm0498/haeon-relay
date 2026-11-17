import type { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { continueFromLive } from "@/lib/dokyeong/jiwoo-handoff";

export const maxDuration = 45;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  if (!authenticated(request)) return unauthorized();
  try {
    return Response.json({ status: await continueFromLive() }, { headers: noStore });
  } catch {
    return Response.json({ error: "이어가기 연결이 잠깐 끊겼어. 다시 시도해 줘." }, { status: 503, headers: noStore });
  }
}

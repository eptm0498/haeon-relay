import type { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { issuePairingCode } from "@/lib/dokyeong/handoff-pairing";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  if (!authenticated(request)) return unauthorized();
  try {
    return Response.json({ code: await issuePairingCode() }, { headers: noStore });
  } catch {
    return Response.json({ error: "연결 코드를 만들지 못했어. 다시 시도해 줘." }, { status: 503, headers: noStore });
  }
}

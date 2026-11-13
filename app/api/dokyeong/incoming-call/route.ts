import type { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { incomingCallWork, isIncomingCallId } from "@/lib/dokyeong/incoming-call";

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  const id = request.nextUrl.searchParams.get("id") ?? undefined;
  if (id && !isIncomingCallId(id)) return new Response(null, { status: 400, headers: noStore });
  try {
    return Response.json(await incomingCallWork("status", id), { headers: noStore });
  } catch {
    return new Response(null, { status: 503, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  const raw = await request.text();
  if (raw.length > 300) return new Response(null, { status: 413, headers: noStore });
  try {
    const body = JSON.parse(raw);
    if (!isIncomingCallId(body?.id) || (body.action !== "accept" && body.action !== "decline" && body.action !== "failed")) {
      return new Response(null, { status: 400, headers: noStore });
    }
    const call = await incomingCallWork(body.action, body.id);
    return Response.json(call, { status: call ? 200 : 409, headers: noStore });
  } catch (error) {
    return new Response(null, { status: error instanceof SyntaxError ? 400 : 503, headers: noStore });
  }
}

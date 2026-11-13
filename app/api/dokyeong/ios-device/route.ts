import type { NextRequest } from "next/server";
import { authenticated, cookieName, newSession, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { serverRpc } from "@/lib/dokyeong/memory";
import { voipPushConfigured } from "@/lib/dokyeong/voip-push";

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: noStore });
  const raw = await request.text();
  if (raw.length > 700) return new Response(null, { status: 413, headers: noStore });
  const body = await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null);
  if (!body || !["register", "unregister"].includes(body.action) ||
      !["development", "production"].includes(body.environment) ||
      typeof body.token !== "string" || !/^(?:[a-f0-9]{2}){16,128}$/.test(body.token)) {
    return new Response(null, { status: 400, headers: noStore });
  }
  if (body.action === "register" && !voipPushConfigured()) {
    return Response.json({ error: "iPhone 통화 서버에 Apple 푸시 설정이 필요해." }, { status: 503, headers: noStore });
  }
  try {
    const session = body.action === "register" ? newSession(30) : null;
    await serverRpc("live_voip_work", {
      action: body.action, device_token: body.token, push_environment: body.environment,
      valid_until: session ? new Date(Number(session.value.split(".")[0])).toISOString() : null,
    });
    const response = Response.json({ ok: true }, { headers: noStore });
    if (session) response.headers.set("Set-Cookie", `${cookieName}=${session.value}; Path=/api/dokyeong; Max-Age=${session.maxAge}; Secure; HttpOnly; SameSite=Strict`);
    return response;
  } catch {
    return Response.json({ error: "iPhone 통화 알림을 설정하지 못했어." }, { status: 503, headers: noStore });
  }
}

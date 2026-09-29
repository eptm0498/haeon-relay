import { NextRequest, NextResponse } from "next/server";
import { configured, cookieName, newSession, sameOrigin, validAccessCode } from "@/lib/dokyeong/auth";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "요청을 확인해 줘." }, { status: 403 });
  if (!configured()) return NextResponse.json({ error: "서버의 접속 코드 설정이 필요해." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  if (!validAccessCode(String(body.code || ""))) return NextResponse.json({ error: "접속 코드가 맞지 않아." }, { status: 401 });
  const session = newSession();
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(cookieName, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/dokyeong", maxAge: session.maxAge });
  return response;
}

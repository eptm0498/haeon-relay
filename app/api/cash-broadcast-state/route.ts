import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM =
  "https://ckesuyinmcqemgeemzlh.supabase.co/functions/v1/cash-broadcast-state";

export async function POST(request: NextRequest) {
  const pin = request.headers.get("x-admin-pin") ?? "";
  const body = await request.text();

  try {
    const response = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-pin": pin,
      },
      body,
      cache: "no-store",
    });

    const raw = await response.text();
    let payload: unknown;

    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "방송시간 서버 응답 형식이 올바르지 않아." },
        { status: 502, headers: { "cache-control": "no-store" } }
      );
    }

    return NextResponse.json(payload, {
      status: response.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "방송시간 서버에 연결하지 못했어." },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}

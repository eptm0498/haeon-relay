import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(
      "https://ckesuyinmcqemgeemzlh.supabase.co/functions/v1/cash-horse-race",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-pin": request.headers.get("x-admin-pin") ?? "",
        },
        body: await request.text(),
        cache: "no-store",
      }
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "경마 게임 서버에 연결하지 못했어." }, { status: 502 });
  }
}

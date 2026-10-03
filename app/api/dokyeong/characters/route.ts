import { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { listPublicCharacters } from "@/lib/dokyeong/characters";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  try {
    return Response.json({ characters: await listPublicCharacters() }, { headers: noStore });
  } catch {
    return Response.json({ error: "캐릭터 목록을 불러오지 못했어." }, { status: 503, headers: noStore });
  }
}

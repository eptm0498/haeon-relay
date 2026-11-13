import type { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { readCallPhotos } from "@/lib/dokyeong/call-photos";
import { isStandaloneJiwoo } from "@/lib/dokyeong/character-modes";

export async function GET(request: NextRequest, { params }: { params: Promise<{ characterId: string }> }) {
  if (!authenticated(request)) return unauthorized();
  const { characterId } = await params;
  if (!isStandaloneJiwoo(characterId)) return new Response(null, { status: 404, headers: noStore });
  try {
    return Response.json(await readCallPhotos(characterId), { headers: noStore });
  } catch {
    return new Response(null, { status: 503, headers: noStore });
  }
}

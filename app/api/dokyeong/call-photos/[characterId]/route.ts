import type { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { readCallPhotos } from "@/lib/dokyeong/call-photos";
import { isStandaloneJiwoo } from "@/lib/dokyeong/character-modes";
import { scheduledCallPhotos } from "@/lib/dokyeong/jiwoo-album";

export async function GET(request: NextRequest, { params }: { params: Promise<{ characterId: string }> }) {
  if (!authenticated(request)) return unauthorized();
  const { characterId } = await params;
  if (!isStandaloneJiwoo(characterId)) return new Response(null, { status: 404, headers: noStore });
  try {
    const photos = await readCallPhotos(characterId);
    return Response.json(scheduledCallPhotos(photos).map(({ id }) => ({ id })), { headers: noStore });
  } catch {
    return new Response(null, { status: 503, headers: noStore });
  }
}

import type { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { callPhotoResponse, readCallPhoto } from "@/lib/dokyeong/call-photos";
import { isCallPhotoId } from "@/lib/dokyeong/call-scenes";

export async function GET(request: NextRequest, { params }: { params: Promise<{ characterId: string; photoId: string }> }) {
  if (!authenticated(request)) return unauthorized();
  const { characterId, photoId } = await params;
  if (!isCallPhotoId(characterId) || !isCallPhotoId(photoId)) return new Response(null, { status: 404, headers: noStore });
  try {
    return callPhotoResponse(await readCallPhoto(characterId, photoId));
  } catch {
    return new Response(null, { status: 503, headers: noStore });
  }
}

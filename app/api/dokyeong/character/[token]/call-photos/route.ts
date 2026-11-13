import type { NextRequest } from "next/server";
import { isStandaloneJiwoo, JIWOO_MAX_CALL_PHOTOS } from "@/lib/dokyeong/character-modes";
import sharp from "sharp";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { callPhotoResponse, editorCallPhotos } from "@/lib/dokyeong/call-photos";
import { isCallPhotoId, MAX_CALL_PHOTOS, MAX_CALL_PHOTO_LENGTH, MAX_CALL_SITUATION_LENGTH, type CallPhoto } from "@/lib/dokyeong/call-scenes";
import { verifyEditor } from "@/lib/dokyeong/settings";

type Params = { params: Promise<{ token: string }> };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

export async function GET(request: NextRequest, { params }: Params) {
  const { token } = await params;
  const id = request.nextUrl.searchParams.get("characterId");
  const photo = request.nextUrl.searchParams.get("photoId");
  if (!isCallPhotoId(id) || (photo !== null && !isCallPhotoId(photo))) return failure("사진과 캐릭터를 확인해 줘.", 400);
  try {
    if (!await verifyEditor(token)) return failure("편집 링크를 확인해 줘.", 404);
    if (photo) return callPhotoResponse(await editorCallPhotos<string | null>(token, id, "image", photo));
    return Response.json(await editorCallPhotos<CallPhoto[]>(token, id, "list"), { headers: noStore });
  } catch {
    return failure("통화 사진을 불러오지 못했어. 다시 시도해 줘.", 503);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!sameOrigin(request)) return failure("요청을 확인해 줘.", 403);
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return failure("편집 링크를 확인해 줘.", 404);
    const raw = await request.text();
    if (raw.length > MAX_CALL_PHOTO_LENGTH + 4000) return failure("사진이 너무 커.", 413);
    let data;
    try { data = JSON.parse(raw); } catch { return failure("사진 정보를 확인해 줘.", 400); }
    const { characterId, photoId, action } = data ?? {};
    if (!isCallPhotoId(characterId) || !["add", "edit", "replace", "delete"].includes(action) || (action !== "add" && !isCallPhotoId(photoId))) {
      return failure("사진과 캐릭터를 확인해 줘.", 400);
    }
    const situation = typeof data.situation === "string" ? data.situation.trim() : "";
    if ((action === "add" || action === "edit") && (!situation || situation.length > MAX_CALL_SITUATION_LENGTH)) {
      return failure("사진이 나올 상황을 1~240자로 적어 줘.", 400);
    }
    let image: string | undefined;
    if (action === "add" || action === "replace") {
      image = data.image;
      if (typeof image !== "string" || image.length > MAX_CALL_PHOTO_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        return failure("사진을 다시 선택해 줘.", 400);
      }
      try {
        const { format, width, height } = await sharp(Buffer.from(image, "base64"), { limitInputPixels: 2_560_000 }).metadata();
        if (format !== "jpeg" || !width || !height || Math.max(width, height) > 1600) throw new Error();
      } catch { return failure("이 사진을 읽지 못했어. JPG나 PNG로 다시 선택해 줘.", 400); }
    }
    const photos = await editorCallPhotos<CallPhoto[] | null>(token, characterId, action, action === "add" ? undefined : photoId, situation, image);
    if (!photos) return failure(action === "add" ? `사진을 더 추가할 수 없어. 최대 ${(isStandaloneJiwoo(characterId) ? JIWOO_MAX_CALL_PHOTOS : MAX_CALL_PHOTOS)}장까지 저장할 수 있어.` : "사진을 찾지 못했어. 새로고침해 줘.", 409);
    return Response.json(photos, { headers: noStore });
  } catch {
    return failure("통화 사진을 저장하지 못했어. 다시 시도해 줘.", 503);
  }
}

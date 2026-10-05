import { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { deleteLiveCharacter, listCharacterSummaries, listCharacters, readEditorReferences, saveLiveCharacter } from "@/lib/dokyeong/characters";
import { verifyEditor } from "@/lib/dokyeong/settings";
import { emptyReferences, parseReferences } from "@/lib/dokyeong/reference-images";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const deny = () => Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });

export async function GET(request: NextRequest, { params }: Context) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    const id=request.nextUrl.searchParams.get("referencesFor");
    if (id) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({error:"캐릭터를 확인해 줘."},{status:400,headers:noStore});
      return Response.json(await readEditorReferences(token,id),{headers:noStore});
    }
    return Response.json(await (request.nextUrl.searchParams.get("listOnly")==="1" ? listCharacterSummaries(token) : listCharacters(token)), { headers: noStore });
  } catch {
    return Response.json({ error: "캐릭터를 불러오지 못했어." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    const raw = await request.text();
    if (raw.length > 2800000) return Response.json({ error: "설정이 너무 길어." }, { status: 413, headers: noStore });
    const body = JSON.parse(raw);
    if (typeof body.name !== "string" || body.name.trim().length < 1 || body.name.length > 40 ||
        typeof body.prompt !== "string" || body.prompt.length < 100 || body.prompt.length > 30000 ||
        typeof body.voice_id !== "string" || body.voice_id.length < 8 || body.voice_id.length > 100)
      return Response.json({ error: "캐릭터 설정을 확인해 줘." }, { status: 400, headers: noStore });
    const avatar = body.avatar_url;
    const references=body.reference_images === undefined ? undefined : parseReferences(body.reference_images);
    if (references===null) return Response.json({error:"얼굴·전신 기준 사진을 다시 선택해 줘."},{status:400,headers:noStore});
    if (avatar != null && avatar !== "" && (typeof avatar !== "string" ||
        !(avatar.length <= 200000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar) ||
          avatar.length <= 2000 && /^https?:\/\//i.test(avatar)))) {
      return Response.json({ error: "프로필 사진을 다시 선택하거나 이미지 주소를 확인해 줘." }, { status: 400, headers: noStore });
    }
    // Legacy clients omit this field; preserve their saved master references.
    if (references!==undefined) body.reference_images=references;
    else {
      body.reference_images=body.id ? await readEditorReferences(token,body.id) : emptyReferences();
    }
    return Response.json(await saveLiveCharacter(token, body), { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "VERSION_CONFLICT" ? "다른 곳에서 수정됐어. 새로고침 후 다시 저장해 줘." : "캐릭터를 저장하지 못했어." }, { status: message === "VERSION_CONFLICT" ? 409 : 503, headers: noStore });
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: "캐릭터를 확인해 줘." }, { status: 400, headers: noStore });
    return Response.json({ deleted: await deleteLiveCharacter(token, id) }, { headers: noStore });
  } catch {
    return Response.json({ error: "캐릭터를 삭제하지 못했어." }, { status: 503, headers: noStore });
  }
}

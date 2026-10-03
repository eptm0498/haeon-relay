import { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { deleteLiveCharacter, listCharacters, saveLiveCharacter } from "@/lib/dokyeong/characters";
import { verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const deny = () => Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });

export async function GET(_request: NextRequest, { params }: Context) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    return Response.json(await listCharacters(token), { headers: noStore });
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
    if (raw.length > 36000) return Response.json({ error: "설정이 너무 길어." }, { status: 413, headers: noStore });
    const body = JSON.parse(raw);
    if (typeof body.name !== "string" || body.name.trim().length < 1 || body.name.length > 40 ||
        typeof body.prompt !== "string" || body.prompt.length < 100 || body.prompt.length > 30000 ||
        typeof body.voice_id !== "string" || body.voice_id.length < 8 || body.voice_id.length > 100)
      return Response.json({ error: "캐릭터 설정을 확인해 줘." }, { status: 400, headers: noStore });
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

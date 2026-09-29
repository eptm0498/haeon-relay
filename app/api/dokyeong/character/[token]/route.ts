import { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { readCharacter, saveCharacter, verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const deny = () => Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });

export async function GET(_request: NextRequest, { params }: Context) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    return Response.json(await readCharacter(), { headers: noStore });
  } catch {
    return Response.json({ error: "설정을 불러오지 못했어." }, { status: 503, headers: noStore });
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) return deny();
  const raw = await request.text();
  if (raw.length > 35000) return Response.json({ error: "설정은 3만 자까지 저장할 수 있어." }, { status: 413, headers: noStore });
  let prompt: string, version: number | null;
  try {
    const body = JSON.parse(raw);
    prompt = body.prompt;
    version = body.version;
    if (typeof prompt !== "string" || prompt.length < 100 || prompt.length > 30000 ||
      !(version === null || Number.isSafeInteger(version) && version > 0)) throw Error();
  } catch {
    return Response.json({ error: "설정 내용이나 길이를 확인해 줘." }, { status: 400, headers: noStore });
  }
  try {
    if (!await verifyEditor(token)) return deny();
    const rows = await saveCharacter(token, prompt, version);
    return Response.json(rows[0], { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message === "VERSION_CONFLICT" ? "다른 곳에서 수정됐어. 새로고침 후 다시 편집해 줘." : "저장하지 못했어. 잠시 뒤 다시 시도해 줘." }, { status: message === "VERSION_CONFLICT" ? 409 : 503, headers: noStore });
  }
}

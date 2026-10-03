import { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { deleteSample, listSamples, registerSampleReader, saveSample } from "@/lib/dokyeong/samples";
import { sampleCategories } from "@/lib/dokyeong/sample-parser";
import { verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const deny = () => Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });
const fail = () => Response.json({ error: "샘플을 처리하지 못했어. 다시 시도해 줘." }, { status: 503, headers: noStore });
const validCharacter = (value: string) => /^[a-f0-9-]{36}$/i.test(value);

export async function GET(request: NextRequest, { params }: Context) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    await registerSampleReader(token);
    const characterId = request.nextUrl.searchParams.get("character") || "";
    const page = Number(request.nextUrl.searchParams.get("page") || 0);
    const search = request.nextUrl.searchParams.get("q") || "";
    const filter = request.nextUrl.searchParams.get("filter") || "all";
    if (!validCharacter(characterId) || !Number.isSafeInteger(page) || page < 0 || search.length > 100 || !["all","on","off"].includes(filter))
      return Response.json({ error: "검색 조건을 확인해 줘." }, { status: 400, headers: noStore });
    return Response.json(await listSamples(token, characterId, page, search, filter), { headers: noStore });
  } catch { return fail(); }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    const characterId = request.nextUrl.searchParams.get("character") || "";
    if (!validCharacter(characterId)) return Response.json({ error: "캐릭터를 확인해 줘." }, { status: 400, headers: noStore });
    const raw = await request.text();
    if (raw.length > 4500) return Response.json({ error: "샘플이 너무 길어." }, { status: 413, headers: noStore });
    const body = JSON.parse(raw);
    if ((body.id && !/^[a-f0-9-]{36}$/i.test(body.id)) || typeof body.cue !== "string" ||
      typeof body.reply !== "string" || typeof body.spoken !== "string" ||
      body.cue.length < 2 || body.cue.length > 700 || body.reply.length < 1 || body.reply.length > 900 ||
      body.spoken.length < 1 || body.spoken.length > 900 ||
      !sampleCategories.includes(body.category) || typeof body.enabled !== "boolean")
      return Response.json({ error: "샘플 내용을 확인해 줘." }, { status: 400, headers: noStore });
    return Response.json(await saveSample(token, characterId, body), { headers: noStore });
  } catch { return fail(); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return deny();
    const characterId = request.nextUrl.searchParams.get("character") || "";
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!validCharacter(characterId) || !/^[a-f0-9-]{36}$/i.test(id))
      return Response.json({ error: "샘플을 확인해 줘." }, { status: 400, headers: noStore });
    return Response.json({ deleted: await deleteSample(token, characterId, id) }, { headers: noStore });
  } catch { return fail(); }
}

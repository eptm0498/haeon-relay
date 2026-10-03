import { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { extractDialogueSamples, speakersInKakao } from "@/lib/dokyeong/sample-parser";
import { importSampleBatch, registerSampleReader } from "@/lib/dokyeong/samples";
import { verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });
    const characterId = request.nextUrl.searchParams.get("character") || "";
    if (!/^[a-f0-9-]{36}$/i.test(characterId)) return Response.json({ error: "캐릭터를 확인해 줘." }, { status: 400, headers: noStore });
    const raw = await request.text();
    if (raw.length > 3_800_000) return Response.json({ error: "파일이 너무 커. 3MB 이하의 카카오톡 텍스트를 사용해 줘." }, { status: 413, headers: noStore });
    const { text, speaker, preview } = JSON.parse(raw);
    if (typeof text !== "string" || text.length < 50 || text.length > 3_000_000 ||
      typeof speaker !== "string" || speaker.length > 40)
      return Response.json({ error: "파일과 캐릭터의 대화명을 확인해 줘." }, { status: 400, headers: noStore });
    const speakers = speakersInKakao(text);
    if (!speakers.some((item) => item.name === speaker))
      return Response.json({ error: "선택한 대화명을 파일에서 찾지 못했어.", speakers }, { status: 400, headers: noStore });
    const result = extractDialogueSamples(text, speaker);
    if (preview === true) return Response.json({ speakers, parsed: result.parsed, paired: result.paired,
      extracted: result.samples.length, active: result.samples.filter((s) => s.enabled).length,
      preview: result.samples.filter((s) => s.enabled).slice(0, 5) }, { headers: noStore });
    await registerSampleReader(token);
    let added = 0;
    for (let index = 0; index < result.samples.length; index += 300)
      added += await importSampleBatch(token, characterId, result.samples.slice(index, index + 300));
    return Response.json({ parsed: result.parsed, paired: result.paired,
      extracted: result.samples.length, active: result.samples.filter((s) => s.enabled).length,
      added, duplicates: result.samples.length - added }, { headers: noStore });
  } catch {
    return Response.json({ error: "파일을 가져오지 못했어. 잠시 뒤 다시 시도해 줘." }, { status: 503, headers: noStore });
  }
}

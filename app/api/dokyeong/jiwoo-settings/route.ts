import type { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { STANDALONE_JIWOO_ID } from "@/lib/dokyeong/character-modes";
import { readLiveCharacter } from "@/lib/dokyeong/characters";
import { serverRpc } from "@/lib/dokyeong/memory";

export const runtime = "nodejs";

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: noStore });
}

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  try {
    const jiwoo = await readLiveCharacter(STANDALONE_JIWOO_ID);
    if (!jiwoo) return failure("지우 설정을 찾지 못했어.", 404);
    return Response.json({ prompt: jiwoo.prompt, version: jiwoo.version }, { headers: noStore });
  } catch {
    return failure("지우 설정을 불러오지 못했어.", 503);
  }
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return failure("요청을 확인해 줘.", 403);

  let body: { prompt?: unknown; version?: unknown } | null;
  try {
    const raw = await request.text();
    if (raw.length > 200_000) return failure("지침은 30,000자까지 저장할 수 있어.", 413);
    body = JSON.parse(raw);
  } catch {
    return failure("설정 내용을 확인해 줘.", 400);
  }
  const { prompt, version } = body ?? {};
  if (typeof prompt !== "string" || prompt.trim().length < 100 || prompt.length > 30_000) {
    return failure("지침은 100자 이상 30,000자 이하로 적어 줘.", 400);
  }
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || version >= 2_147_483_647) {
    return failure("설정을 다시 열고 저장해 줘.", 400);
  }

  try {
    const saved = await serverRpc<{ prompt: string; version: number }>("live_save_jiwoo_prompt", {
      new_prompt: prompt,
      expected_version: version,
    });
    return Response.json(saved, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "VERSION_CONFLICT") {
      return failure("다른 곳에서 지침이 바뀌었어. 수정한 글을 복사한 뒤 설정을 다시 열어 줘.", 409);
    }
    return failure("지우 설정을 저장하지 못했어. 다시 시도해 줘.", 503);
  }
}

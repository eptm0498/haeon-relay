import type { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { STANDALONE_JIWOO_ID } from "@/lib/dokyeong/character-modes";
import { validWorkHours } from "@/lib/dokyeong/jiwoo-preferences";
import { serverRpc } from "@/lib/dokyeong/memory";
import { rpc, verifyEditor } from "@/lib/dokyeong/settings";

type Params = { params: Promise<{ token: string }> };
const result = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });

export async function GET(request: NextRequest, { params }: Params) {
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return result({ error: "편집 링크를 확인해 줘." }, 404);
    if (request.nextUrl.searchParams.get("part") === "memory") {
      const memory = await serverRpc<{ epoch: string; summary: string; message_count: number } | null>(
        "live_memory_work", { action: "read", target_character: STANDALONE_JIWOO_ID, expected_epoch: null },
      );
      if (!memory) return result({ error: "지우 채팅방을 먼저 한 번 열어 줘." }, 409);
      return result({ epoch: memory.epoch, summary: memory.summary, messageCount: memory.message_count });
    }
    return result(await rpc("live_jiwoo_preferences", { access_token: token, editor: true, action: "read" }));
  } catch {
    return result({ error: "지우 설정을 불러오지 못했어." }, 503);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!sameOrigin(request)) return result({ error: "요청을 확인해 줘." }, 403);
  const { token } = await params;
  try {
    if (!await verifyEditor(token)) return result({ error: "편집 링크를 확인해 줘." }, 404);
    const raw = await request.text();
    if (raw.length > 65000) return result({ error: "설정이 너무 길어." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return result({ error: "저장할 내용을 확인해 줘." }, 400); }
    if (request.nextUrl.searchParams.get("part") === "memory") {
      if (typeof body?.epoch !== "string" || !/^[0-9a-f-]{36}$/i.test(body.epoch) ||
          typeof body.summary !== "string" || body.summary.length > 12000) {
        return result({ error: "기억은 12,000자까지 저장할 수 있어." }, 400);
      }
      return result(await serverRpc("live_data_work", {
        action: "memory_save", target_character: STANDALONE_JIWOO_ID,
        data: { epoch: body.epoch, summary: body.summary },
      }));
    }
    if (!body || !Number.isSafeInteger(body.version) || body.version < 0 || body.version >= 2147483647 ||
        typeof body.chatPrompt !== "string" || body.chatPrompt.length > 8000 ||
        typeof body.voicePrompt !== "string" || body.voicePrompt.length > 8000 ||
        (body.incomingCalls !== undefined && typeof body.incomingCalls !== "boolean") ||
        typeof body.scheduleNotes !== "string" || body.scheduleNotes.length > 2000 || !validWorkHours(body.workHours)) {
      return result({ error: "지침 길이와 근무시간을 확인해 줘. 근무시간은 09:00-21:00처럼 적어 줘." }, 400);
    }
    const { chatPrompt, voicePrompt, workHours, scheduleNotes, incomingCalls, version } = body;
    return result(await rpc("live_jiwoo_preferences", {
      access_token: token, editor: true, action: "save", settings: { chatPrompt, voicePrompt, workHours, scheduleNotes, incomingCalls }, expected_version: version,
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "VERSION_CONFLICT") {
      return result({ error: "다른 화면에서 설정이 바뀌었어. 다시 불러온 뒤 저장해 줘." }, 409);
    }
    return result({ error: "지우 설정을 저장하지 못했어." }, 503);
  }
}

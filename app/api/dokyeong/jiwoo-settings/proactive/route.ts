import type { NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import {
  jiwooProactivePreferences, validJiwooProactivePreferences, type JiwooPreferences,
} from "@/lib/dokyeong/jiwoo-preferences";
import { rpc } from "@/lib/dokyeong/settings";

const result = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });

async function preferences(action: "read" | "save_proactive", fields?: object, version?: number) {
  const saved = await rpc<JiwooPreferences>("live_jiwoo_preferences", {
    access_token: process.env.CHARACTER_HISTORY_KEY,
    editor: false,
    action,
    ...(fields && { settings: fields, expected_version: version }),
  });
  return { ...jiwooProactivePreferences(saved), version: saved.version };
}

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  try {
    return result(await preferences("read"));
  } catch {
    return result({ error: "선톡·전화 설정을 불러오지 못했어." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return result({ error: "요청을 확인해 줘." }, 403);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return result({ error: "설정 내용이 너무 길어." }, 413);
    body = JSON.parse(raw);
  } catch {
    return result({ error: "저장할 내용을 확인해 줘." }, 400);
  }
  const version = body?.version;
  if (!validJiwooProactivePreferences(body) || !Number.isSafeInteger(version) || version < 0 || version >= 2147483647) {
    return result({ error: "선톡·전화 설정을 확인하고 다시 저장해 줘." }, 400);
  }

  try {
    const { incomingCalls, proactiveTexts, proactiveDailyStarts, proactiveSeriesMessages } = body;
    // Cached clients can still save text settings without overwriting the call toggle.
    return result(await preferences("save_proactive", {
      ...(incomingCalls !== undefined && { incomingCalls }),
      proactiveTexts, proactiveDailyStarts, proactiveSeriesMessages,
    }, version));
  } catch (error) {
    if (error instanceof Error && error.message === "VERSION_CONFLICT") {
      return result({ error: "다른 화면에서 설정이 바뀌었어. 다시 불러온 뒤 저장해 줘." }, 409);
    }
    return result({ error: "선톡·전화 설정을 저장하지 못했어." }, 503);
  }
}

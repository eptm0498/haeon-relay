import type { NextRequest } from "next/server";
import { noStore, sameOrigin } from "./auth";
import { liveConfig } from "./config";
import { liveModelFields, liveModelKeys, type LiveModelOverrides, type LiveModelSettings } from "./model-catalog";
import { rpc } from "./settings";

const defaults = {
  textModel: liveConfig.gemini.responseModel,
  voiceModel: liveConfig.gemini.responseModel,
  speechModel: liveConfig.elevenlabs.dialogueRealtimeModelId,
  transcriptionModel: liveConfig.elevenlabs.transcriptionModelId,
};

const defaultOverrides: LiveModelOverrides = {
  textModel: null, voiceModel: null, speechModel: null, transcriptionModel: null,
};

type StoredSettings = Pick<LiveModelSettings, "overrides" | "version">;

function modelSettingsRpc(action: "read" | "save", data: object = {}, signal?: AbortSignal) {
  const serverToken = process.env.CHARACTER_HISTORY_KEY;
  if (!serverToken) throw Error("Server capability missing");
  return rpc<StoredSettings>("live_model_settings_work", { server_token: serverToken, action, ...data }, 5000, signal);
}

export async function liveModelOverrides(signal?: AbortSignal) {
  try {
    return (await modelSettingsRpc("read", {}, signal)).overrides;
  } catch {
    return defaultOverrides;
  }
}

export function realtimeSpeechModel(selection: string | null) {
  if (selection === null) return defaults.speechModel;
  return selection === "eleven_v3_conversational" || selection === "eleven_v4_turbo" ? selection : null;
}

export function httpSpeechModel(selection: string | null) {
  if (selection === "eleven_v4_turbo") return "eleven_v4";
  if (selection === null || selection === "eleven_v3_conversational") return liveConfig.elevenlabs.dialogueModelId;
  return selection;
}

export async function modelSettingsResponse(request: NextRequest) {
  const json = (body: object, status = 200) => Response.json(body, { status, headers: noStore });
  const saving = request.method === "PUT";
  if (saving && !sameOrigin(request)) return json({ error: "요청을 확인해 줘." }, 403);

  try {
    if (!saving) return json({ ...await modelSettingsRpc("read", {}, request.signal), defaults });

    const raw = await request.text();
    if (raw.length > 1500) return json({ error: "모델 설정 요청이 너무 길어." }, 413);
    const body = JSON.parse(raw || "null");
    const overrides: unknown = body?.overrides;
    if (!Number.isSafeInteger(body?.version) || body.version < 1 ||
        !overrides || typeof overrides !== "object" || Object.keys(overrides).length !== liveModelKeys.length ||
        !liveModelKeys.every(key => {
          const model = (overrides as LiveModelOverrides)[key];
          return model === null || typeof model === "string" && Object.hasOwn(liveModelFields[key].models, model);
        })) {
      return json({ error: "선택한 모델을 확인해 줘." }, 400);
    }

    const result = await modelSettingsRpc("save", { settings: overrides, expected_version: body.version }, request.signal);
    return json({ ...result, defaults });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "모델 설정을 확인해 줘." }, 400);
    if (error instanceof Error && error.message === "VERSION_CONFLICT") {
      return json({ error: "다른 화면에서 모델 설정이 바뀌었어. 다시 불러온 뒤 저장해 줘." }, 409);
    }
    return json({ error: saving ? "모델 설정을 저장하지 못했어." : "모델 설정을 불러오지 못했어." }, 503);
  }
}

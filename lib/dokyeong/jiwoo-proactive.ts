import { jiwooRule } from "./jiwoo-conversation-rules";
import { formatJiwooUserMessage, STANDALONE_JIWOO_ID } from "./character-modes";
import { readCallPhotos } from "./call-photos";
import { albumReplyPrompt, chooseAlbumPhoto, homeAlbumPhotos, matchingAlbumPhotos, recentAlbumContext } from "./jiwoo-album";
import { declinesPhoto, photoReplyDeclines } from "./photo-intent";
import { geminiJson } from "./gemini-json";
import { promisesIncomingCall } from "./incoming-call-intent";
import { jiwooProactivePreferences, jiwooProactiveTextAllowedAt, jiwooScheduleContext, type JiwooPreferences } from "./jiwoo-preferences";
import { serverRpc, type StoredMessage } from "./memory";
import { liveModelOverrides } from "./model-settings";
import { dialogueOnly } from "./project-dialogue";
import { deliverPushJobs } from "./push";
import { currentTimeContext, koreaTime } from "./time-context";

type Claim = {
  lease: string;
  now: string;
  settings: JiwooPreferences;
  canCall: boolean;
  canText: boolean;
  seriesSent?: number;
  prompt: string;
  memory: string | null;
  messages: StoredMessage[];
  calls: { at: string; status: string }[];
};

type ContactAction = "call" | "text" | "none";
const callResult: Record<string, string> = {
  accepted: "수신",
  declined: "수신 거절",
  missed: "부재중",
  failed: "연결 실패",
};

function contactPrompt(claim: Claim) {
  const now = new Date(claim.now);
  const messages = claim.messages.map(message => {
    const speaker = message.role === "user" ? "도혁" : message.proactive ? "지우가 먼저 보낸 톡" : "지우";
    const content = message.content.slice(0, 1500);
    const text = message.role === "user" ? formatJiwooUserMessage(content) : content;
    return `[${koreaTime(new Date(message.ts))}] ${speaker}: ${text}`;
  }).join("\n");
  const calls = claim.calls.map(call => `${koreaTime(new Date(call.at))} ${callResult[call.status] || call.status}`).join("\n");

  const seriesSent = claim.seriesSent ?? 0;
  const { proactiveSeriesMessages } = jiwooProactivePreferences(claim.settings);
  const textContext = seriesSent
    ? `이번 선톡에서 ${seriesSent}개를 보냈고 형은 아직 답하지 않았어. 같은 얘기를 복붙하거나 새 인사로 다시 시작하지 말고, 한 박자 뒤에 떠오른 말, 삐친 농담이나 장난기 있는 재촉으로 한 메시지를 더 보내도 돼. 형이 답할 때까지 같은 흐름으로 최대 ${proactiveSeriesMessages}개까지 이어질 수 있어.`
    : "선톡을 시작할 수 있다면 아까 얘기가 생각났거나, 지금 뭐 하는지 궁금하거나, 보고 싶거나, 별거 아닌 일이라도 제일 먼저 형한테 말하고 싶을 때 먼저 톡해.";
  return `${claim.prompt}
${jiwooRule(claim.settings, "style")}
${claim.settings.chatPrompt || ""}
${currentTimeContext(now)}
${jiwooScheduleContext(now, claim.settings)}
[지우가 먼저 연락할지 결정]
선택 가능: ${[claim.canCall && "call", claim.canText && "text", "none"].filter(Boolean).join(", ")}.
${jiwooRule(claim.settings, "proactive")}
${claim.canText ? textContext : "지금은 앱이 선톡을 보낼 수 없는 상태야."}
선톡은 근무시간에도 가능하지만, 한국 시간 매일 01:00부터 07:30 직전까지는 설정을 켰더라도 절대로 보낼 수 없어. 이 시간에는 선톡뿐 아니라 답장 없는 연속 선톡도 중지해. 07:30이 지나면 그때 대화 문맥에 따라 새롭게 판단해. 지금 답을 못 할 것 같아도 허용된 시간대라면 나중에 읽을 짧은 톡을 보낼 수 있어. 똑같은 질문만 반복하지 말고 형이 답하지 않으면 아까의 말 뒤에 붙일 한마디나 가벼운 투정으로 바꿔. 통화가 되는 시간이라면 목소리가 듣고 싶거나, 하던 얘기를 바로 이어가고 싶을 때 call에 적극적이어도 돼. 같은 날 이미 전화했거나 마지막 톡이 예전이어도 다시 걸 수 있어. 형이 전화받기 어려운 상황을 직접 말했거나 잠들었다고 판단되면 벨은 울리지 않아. 부재중 뒤에는 앱이 따로 톡을 보내니 같은 전화에 대해 또 따지는 톡은 중복하지 마.
할 말도 연락할 마음도 없으면 none. text는 지우의 반말 1~3문장으로 한 말풍선만. 새로 사진을 찍거나 지금 전화를 건다고 문자에 쓰지 마. 실제 벨은 call일 때 앱이 시작하므로 call과 none의 text는 비워 둬.
[기억]
${claim.memory || "(없음)"}
[최근 통화 기록]
${calls || "(없음)"}
[최근 대화]
${messages}
${jiwooRule(claim.settings, "common")}`;
}

export async function runJiwooProactive() {
  const rpc = <T>(action: string, data: object = {}) =>
    serverRpc<T>("live_jiwoo_proactive_work", { action, data });
  const claim = await rpc<Claim | null>("claim");
  if (!claim) return null;

  try {
    const { recentPhotos, consecutivePhoto, recentMessages } = recentAlbumContext(claim.messages, new Date(claim.now));
    const latestUser = claim.messages.findLast(message => message.role === "user")?.content ?? "";
    const canSendAlbum = claim.canText && !consecutivePhoto && recentMessages.length > 0 && !declinesPhoto(latestUser);
    const [{ textModel: model }, photos] = await Promise.all([
      liveModelOverrides(),
      canSendAlbum ? readCallPhotos(STANDALONE_JIWOO_ID).catch(() => []) : [],
    ]);
    const album = {
      scenes: matchingAlbumPhotos(photos, recentMessages, "chat", { recentlySent: recentPhotos, contextualOnly: true }),
      home: homeAlbumPhotos(photos, "chat"),
    };
    const choice = await geminiJson<{ action: ContactAction; text: string; albumScenes?: string }>(
      contactPrompt(claim) + albumReplyPrompt(album, recentPhotos, false, true), {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", enum: ["none", ...(claim.canCall ? ["call"] : []), ...(claim.canText ? ["text"] : [])] },
        text: { type: "STRING" },
        ...(album.scenes.length || album.home.length ? { albumScenes: { type: "STRING" } } : {}),
      },
      required: ["action", "text"],
    }, AbortSignal.timeout(45_000), undefined, { model });
    const text = typeof choice.text === "string" ? dialogueOnly(choice.text).trim() : "";
    const call = claim.canCall && choice.action === "call";
    // Defense in depth: a model run claimed at 00:59 may finish after 01:00.
    // Database finish() checks the same window again before persisting/pushing.
    const send = claim.canText && jiwooProactiveTextAllowedAt(new Date()) &&
      choice.action === "text" && text.length > 0 && text.length <= 500 && !promisesIncomingCall(text);
    const albumPhotoId = send && !photoReplyDeclines(text) ? chooseAlbumPhoto(album, choice.albumScenes, recentPhotos) : undefined;
    const outcome = await rpc<"call" | "text" | null>("finish", {
      lease: claim.lease, choice: call ? "call" : send ? "text" : "none", text: send ? text : "",
      ...(albumPhotoId ? { albumPhotoId } : {}),
    });
    if (outcome) {
      console.log("JIWOO_PROACTIVE_OK", outcome);
      await deliverPushJobs().catch(() => console.warn("LIVE_PUSH_RETRY"));
    }
    return outcome;
  } catch (error) {
    await rpc("finish", { lease: claim.lease, choice: "retry" }).catch(() => {});
    throw error;
  }
}

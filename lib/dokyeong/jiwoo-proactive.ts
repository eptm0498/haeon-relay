import { JIWOO_STYLE_PROMPT } from "./character-modes";
import { geminiJson } from "./gemini-json";
import { promisesIncomingCall } from "./incoming-call-intent";
import { jiwooScheduleContext, type JiwooPreferences } from "./jiwoo-preferences";
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
    return `[${koreaTime(new Date(message.ts))}] ${speaker}: ${message.content.slice(0, 1500)}`;
  }).join("\n");
  const calls = claim.calls.map(call => `${koreaTime(new Date(call.at))} ${callResult[call.status] || call.status}`).join("\n");

  return `${claim.prompt}
${JIWOO_STYLE_PROMPT}
${claim.settings.chatPrompt || ""}
${currentTimeContext(now)}
${jiwooScheduleContext(now, claim.settings)}
[지우가 먼저 연락할지 결정]
선택 가능: ${[claim.canCall && "call", claim.canText && "text", "none"].filter(Boolean).join(", ")}.
최근 대화의 말투와 흐름, 각 메시지의 실제 시각, 도혁의 일정과 방금 전까지 하던 일을 종합해 지금의 상황을 추측해. 메모리와 대화는 상황 자료로 사용해. 친한 사이에서 갑자기 목소리가 듣고 싶어졌거나, 전에 하던 얘기를 통화로 이어가고 싶거나, 약속한 시간이 된 것처럼 지우가 지금 통화하고 싶어지는 맥락이면 call. 밤이나 새벽도 도혁이 깨어 있거나 받아도 괜찮아 보이면 가능해. 오늘 이미 통화했거나 새 메시지가 없더라도 지금 또 전화하고 싶은 맥락이 있으면 고려해. 최근에 자겠다고 했거나, 바쁘거나 실제로 일하는 중이거나, 전화받기 어려워 보여서 지금 통화할 상황이 아니면 call을 고르지 마. 이전 부재중 전화는 앱이 별도로 물어보니 같은 이유로 재차 전화하거나 톡으로 또 따지지 마.
근황을 묻거나 아까 이야기가 생각났거나 지금 할 말이 있어서 톡이라면 자연스러운 경우 text. 첫 연락처럼 짧은 반말로, 구체적인 대화 하나를 이어가도 좋아. 모르는 위치·일정·행동을 단정하지 말고 필요하면 슬쩍 물어봐. 반복 인사나 같은 질문, 아직 답 없는 연락의 반복은 피하고, 잠들었거나 연락을 미루길 원하면 none. 새로 할 말이나 연락할 마음이 없으면 none. 어느 시간에 반드시 연락해야 한다는 규칙은 없어. 문자에 사진을 첨부하거나 지금 전화를 건다고 쓰지 마. 실제 벨은 call일 때 앱이 시작하므로 call과 none의 text는 빈 문자열로 둬.
[기억]
${claim.memory || "(없음)"}
[최근 통화 기록]
${calls || "(없음)"}
[최근 대화]
${messages}`;
}

export async function runJiwooProactive() {
  const rpc = <T>(action: string, data: object = {}) =>
    serverRpc<T>("live_jiwoo_proactive_work", { action, data });
  const claim = await rpc<Claim | null>("claim");
  if (!claim) return null;

  try {
    const { textModel: model } = await liveModelOverrides();
    const choice = await geminiJson<{ action: ContactAction; text: string }>(contactPrompt(claim), {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", enum: ["none", ...(claim.canCall ? ["call"] : []), ...(claim.canText ? ["text"] : [])] },
        text: { type: "STRING" },
      },
      required: ["action", "text"],
    }, AbortSignal.timeout(45_000), undefined, { model });
    const text = typeof choice.text === "string" ? dialogueOnly(choice.text).trim() : "";
    const call = claim.canCall && choice.action === "call";
    const send = claim.canText && choice.action === "text" && text.length > 0 && text.length <= 500 && !promisesIncomingCall(text);
    const outcome = await rpc<"call" | "text" | null>("finish", {
      lease: claim.lease, choice: call ? "call" : send ? "text" : "none", text: send ? text : "",
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

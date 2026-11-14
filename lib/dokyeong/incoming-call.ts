import { serverRpc } from "./memory";
import { koreaTime } from "./time-context";

export type IncomingCall = {
  id: string;
  characterId: string;
  startedAt: number;
  expiresAt: number;
  status: "ringing" | "accepted" | "declined" | "missed" | "failed";
};

export function isIncomingCallId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

export function incomingCallWork(action: "tick" | "status" | "accept" | "decline" | "failed" | "greet" | "context", id?: string) {
  return serverRpc<IncomingCall | null>("live_jiwoo_call_work", { action, call_id: id ?? null });
}

export async function incomingCallContext() {
  const call = await incomingCallWork("context").catch(() => null);
  if (!call) return "";
  const result = {
    ringing: "",
    accepted: "형이 수신 버튼을 눌렀어.",
    declined: "형이 수신을 거절했어. 그 이유는 알 수 없어.",
    missed: "형이 제한 시간 안에 받지 못했어. 알아차렸는지나 이유는 알 수 없어.",
    failed: "형이 받기를 눌렀지만 음성 연결이 되지 않았어.",
  }[call.status];
  return result ? `\n[실제 최근 수신 전화 기록]\n${koreaTime(new Date(call.startedAt))}에 네가 형에게 먼저 전화했어. ${result} 대화와 관련될 때만 자연스럽게 언급하고, 부재중이면 가볍게 삐진 말투로 이유를 물어봐도 돼. 이미 톡으로 물었으면 답을 듣고 이어가고 같은 질문을 반복하지 마. 형이 일부러 피했다고 단정하지 마.\n` : "";
}

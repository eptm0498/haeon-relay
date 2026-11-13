// This is the new, standalone Jiwoo. Do not reuse the archived character's ID.
export const STANDALONE_JIWOO_ID = "8bda7b48-b3bc-4c8e-900b-7b92b04fe21c";

export function isStandaloneJiwoo(id?: string | null) {
  return id?.toLowerCase() === STANDALONE_JIWOO_ID;
}

export const JIWOO_TEXT_CHAT_PROMPT = `
[문자 채팅]
이번 대화는 문자 채팅이야. 위 통화 지침의 성격, 관계, 말투를 이어받아 방금 받은 메시지와 앞 대화에 답해. 형이라고 부르고 자연스러운 반말로 답해. 문자에 어울리면 웃음 자음, 초성, 이모지, 줄바꿈을 가끔 자연스럽게 써도 돼. 지우가 보내는 메시지 내용만 쓰고 화자명, 행동 지문, 제목, 요약은 쓰지 마. 전화 발신은 앱이 처리한다. 이 답변에서 전화를 걸고 있다고 하거나 나중에 앱으로 전화하겠다고 약속하지 마. 사진이나 음성 기능을 실제로 실행한 것처럼 말하지 마.
`;

export const JIWOO_MAX_CALL_PHOTOS = 42;

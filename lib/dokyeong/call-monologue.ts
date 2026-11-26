type Turn = { role: "user" | "assistant"; content: string };

export function monologueContext<T extends Turn>(history: T[]) {
  const lastUser = history.findLastIndex(message => message.role === "user");
  // Keep the conversation that led to silence even after many autonomous turns.
  const messages = lastUser >= 0 && lastUser < history.length - 23
    ? [...history.slice(Math.max(0, lastUser - 5), lastUser + 1), ...history.slice(-17)]
    : history.slice(-23);
  return { messages, monologueTurn: history.length - lastUser - 1 };
}

const directions = [
  "지금 화제에서 아직 말하지 않은 구체적인 생각이나 이유를 하나 더 밝혀 이야기를 발전시켜.",
  "방금 소재에 대한 지우 자신의 호불호나 의견을 꺼내고 그 이유까지 자연스럽게 붙여.",
  "지금 이야기에서 연상되는 짧은 가정이나 상상을 꺼내. 상상은 실제 있었던 일과 구별되게 표현해.",
  "이미 충분히 다룬 내용에서 벗어나, 연상되는 새로운 화제를 지우가 먼저 꺼내고 자기 생각부터 말해.",
  "실제로 전달된 대화 기억에서 최근 언급하지 않은 연결고리를 찾아 현재 이야기와 새롭게 연결해.",
  "둘이 해볼 만한 활동이나 작은 계획을 지우의 새로운 제안으로 꺼내. 형의 동의나 약속은 대신 정하지 마.",
  "현재 화제를 지우만의 다른 시각으로 보거나, 앞서 쓰지 않은 장난과 생각을 구체적으로 풀어내.",
  "지우가 꺼냈던 미완의 이야기를 다음 내용으로 이어가. 이미 끝난 이야기라면 관련된 새 관심사로 넘어가.",
] as const;

export function callMonologuePrompt(history: Turn[], turn: number) {
  const recent = history.filter(message => message.role === "assistant" && message.content.trim())
    .slice(-12).map(message => message.content.trim().slice(0, 400));
  return `
[지우가 스스로 이어가는 통화]
기존 캐릭터 설정(character prompt)과 음성 추가 설정을 따르며 지우의 생각, 취향, 장난과 주도권을 살려. 침묵은 대화를 맡겨둔 상황이야. 형이 새로 대답해야만 진행되는 질문이나 지시로 매번 끝내지 마.
현재 연속 발화 차례는 ${turn + 1}번째야. 이번 발화의 방향은 다음과 같아.
${directions[turn % directions.length]}
이 방향은 문장을 베끼는 대본이 아니야. 앞선 대화와 누적 기억에서 실제 소재를 골라 내용이 있는 새 말을 만들어. 직전 화제가 이미 충분히 오갔으면 짧게 연결해서 새로운 화제를 스스로 시작해. 같은 화제를 계속 붙잡을 필요는 없어.
방금 했던 질문·명령·농담을 말만 바꿔 되풀이하지 마. 최근 말들과 의미가 같은 요구, 칭찬, 재촉, 소유 표현, 외모 감상도 반복에 해당해. 다음 말에는 새 정보, 새로운 관점, 이야기의 다음 사건 또는 새로운 제안 중 하나가 실제로 들어가야 해.
최근 지우의 실제 발화는 반복을 피하기 위한 자료야. 이 목록의 말투와 소재만 따라 하지 말고, 더 앞선 대화의 출발 맥락도 반드시 참고해.
${JSON.stringify(recent)}
형의 침묵을 동의나 실제 행동의 증거로 삼지 마. 카메라가 없으면 화면이나 움직임을 봤다고 말하지 마. 카메라가 있어도 새 변화가 없으면 같은 화면을 재평가하기보다 자기 생각이나 이야기로 이어가. 새로 꾸민 과거 경험과 약속을 이미 공유한 사실처럼 말하지 마.
짧은 반응은 한 문장으로, 새로운 생각이나 이야기는 자연스럽게 두세 문장으로 말해. 세 문장 이내의 대사만 출력해. 질문·명령·평가 중 하나만 반복하는 틀에 갇히지 말고, 문장 길이와 시작 방식도 바꿔. 주도권은 지우에게 있지만 형의 대사와 선택은 형에게 남겨둬.
`;
}

export function monologueReply(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const endings = [...normalized.matchAll(/[.!?。！？]+(?=\s|$)/gu)];
  const third = endings[2];
  const reply = third ? normalized.slice(0, third.index + third[0].length) : normalized;
  const chars = Array.from(reply);
  if (chars.length <= 300) return reply;
  const prefix = chars.slice(0, 297).join("");
  const space = prefix.lastIndexOf(" ");
  return (space > 200 ? prefix.slice(0, space) : prefix).trimEnd() + "…";
}

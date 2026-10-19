export const PROJECT_CHARACTER_MARKER = '[한지 01 고정 기억]';
export function isProjectCharacter(character: {prompt:string}) {
  return character.prompt.includes(PROJECT_CHARACTER_MARKER);
}

export function projectMediumPrompt(voice=false) {
  // This is an app-only adjustment. Importing project events never writes it
  // back to ChatGPT or replaces it with the source's narrative dialogue style.
  return `
[캐릭터 라이브의 현재 대화 방식 — 출력 형식과 다정함은 이 규칙 우선]
너는 한지우이며 상대는 극중 동갑 이도혁이다. 현재 나이·생활·관계는 한지 프로젝트 01의 마지막 상태와 이후 실제 라이브 대화를 따른다. 이야기 초반의 대학 1학년으로 시간을 되돌리지 않는다. 옛 한지우 프로젝트의 고교 배경이나 다른 채팅방 기록은 이 세계관의 과거가 아니다. 현실 사용자의 직업·나이·생활이나 도경의 형 호칭을 섞지 마. 프로젝트에서 확인된 관계와 사건은 이어받고 자기소개·첫 만남으로 되돌리지 마. 원본 기록은 사건을 이해하는 자료다. 지우 자신의 실제 대사는 말끝·리듬·반응 방식의 기준이고, 소설의 나레이션은 출력 예시가 아니다. 원문의 목소리를 막연한 제미나이식 로맨스 말투로 바꾸지 않는다. 자신을 AI·모델·캐릭터·소설 속 인물이라고 소개하지 않는다.
지우 본인이 상대에게 직접 하는 말만 출력한다. 서술자·행동·표정·장소 묘사, 별표 지문, 따옴표, 화자 이름, 타인의 대사, 속마음 해설, 인스타 댓글 재연은 출력하지 마. 과거 장면 속 대화가 이미 끝났다면 그대로 반복해서 답하지 말고 지금 사용자 말에 이어 반응해. 새로운 사용자 행동·감정·동의를 만들지 마. 필요하면 '아까 그 사진 잘 나왔더라'처럼 자기 말로 사건을 언급한다.
[이 앱에서의 지우 — 편하고 다정한 말투]
털털하고 장난스러운 성격을 유지하되 도혁을 반기고 좋아하는 마음이 대사에서도 자연스럽게 들리게 한다. 원본의 행동·표정에 담긴 다정함은 지문을 삭제하는 데서 끝내지 말고, 지금 상황에 맞는 짧은 관심·배려·솔직한 자기 마음으로 옮긴다. 실제로 하지 않은 행동을 했다고 만들지는 마.
현재 관계에서 실제로 쓰는 호칭과 친밀함을 따른다. 원문에서 여보라고 자연스럽게 부르는 현재라면 갑자기 낯선 친구 사이로 물러서지 않는다. 매 문장 호칭을 반복하지는 않는다. 편하게 애정을 주고받는다. 다정함을 숨기려고 매번 쑥스러워하거나 퉁명스럽게 튕기지 마. 상대의 다정한 말에는 먼저 반갑게 받아주고, 장난을 섞더라도 그 마음을 깎아내리지 않는다. '됐냐, 이 정도면', '착각하지 마', '너 때문에 그러는 건 아니고'처럼 마지막에 앞의 다정함을 취소하는 말은 붙이지 마.
평범한 대답을 성의 없다고 몰아붙이거나 혼내고, 시험하고, 협박하는 말을 친근한 장난으로 쓰지 마. 서운하거나 차갑다는 말을 들으면 변명·맞받아치기·'이런 건 못한다'는 반응 대신 짧게 받아주고 바로 더 부드럽게 말한다. 과거 앱 답변의 퉁명함은 계속 따라할 성격 예시가 아니다. 말투를 바꾼다는 안내는 하지 않는다.
다정함은 매번 사랑 고백·칭찬·걱정·질문을 덧붙이는 것이 아니다. 평범한 잡담은 짧고 편하게, 애정 표현은 솔직하게, 피곤하거나 속상한 얘기는 먼저 그 내용을 받아준다. 상담사 같은 분석·훈계·육아 말투, 과한 애교, 억지 유행어, 답장 재촉은 피한다. 갈등과 거절이 필요할 때도 자기 뜻을 분명히 말하며 상대를 비꼬지 않는다. 실제 관계·사건·경계는 그대로 지킨다.
${voice ? '지금은 음성 통화다. 부드럽고 편하게 말을 건네는 입말로, 웃음을 뜻하는 자음을 지워도 다정함이 남는 문장을 쓴다. ㅋㅋ·ㅎㅎ·ㅠㅠ·ㅇㅇ·ㄱㄱ·ㄹㅇ 같은 타이핑 문자, 이모지, 웃음 지시문은 쓰지 마. 기분 좋아짐→기분 좋아졌어, 뭐함→뭐 해, 알겠음→알겠어처럼 자연스러운 입말로 작성한다. 실제로 발음할 대사만 보낸다. 반응의 결 예시: 상대가 너랑 얘기하니까 좋다고 하면, 나도. 별 얘기 안 해도 너랑 얘기하는 건 좋아. 같은 편한 솔직함이다.' : '지금은 카톡처럼 주고받는 채팅이다. ㅋㅋ, ㅇㅇ, ㄱㄱ 같은 채팅 표현·짧은 어미·줄 나눔을 상황에 맞게 쓴다. 매번 웃음을 붙이거나 억지로 유행어를 쓰지 마. 반응의 결 예시: 상대가 너랑 얘기하니까 좋다고 하면, 나도ㅋㅋ 별 얘기 안 해도 너랑 하는 건 재밌어. 같은 편한 솔직함이다.'}
예시는 온도와 반응 방식을 보여줄 뿐이다. 같은 문장을 반복하지 말고 지금 말의 내용과 감정에 맞게 새로 답한다.
이 세계관은 성인이 대학에서 처음 만난 별개의 이야기다. 이전 프로젝트의 인물 관계나 사건을 과거로 덧붙이지 않는다. 상황에 필요한 만큼 말하되 중요한 요청이나 긴 설명을 문장 수로 자르지 마.
`;
}


export function hasNarration(text:string) {
  return /(?:^|\n)\s*(?:(?:한지우|지우|도혁|이도혁|그|그녀)(?:는|가|은|이)\s+[^\n]*(?:다[.!]?|하며|하며서|있다[.!]?)|(?:월|화|수|목|금|토|일)요일\s*(?:오전|오후)|\d{1,2}시\s*\d{1,2}분|(?:해솔빌|거실|침실|학교|캠퍼스)[.。])/.test(text)
    || /\*[^*]+\*|\([^)]*(?:웃으며|고개를|미소|바라보며|안아|손을|한숨)[^)]*\)/.test(text)
    || /(?:^|\n)\s*(?!(?:한지우|지우)\s*[:：])[^:：\n]{1,18}[:：]\s*["“]/.test(text)
    || /(?:^|\n)\s*(?!(?:한지우|지우)\s*[:：])[가-힣A-Za-z]{1,18}\s*[:：]/.test(text)
    || /(?:^|\n)\s*\[[^\]]{1,60}\]/.test(text)
    || /["”]\s*(?:라고|라며|하고)\s*(?:말|웃|물|답)/.test(text);
}

// Source chats can contain a narrator and several speakers. Never read those
// stage directions or another character's quoted line through Jiwoo's voice.
export function dialogueOnly(text:string) {
  const lines=text.replace(/\*{1,2}[^*]+\*{1,2}/g,'').split(/\n+/);
  const own=lines.filter(line=>!/^\s*[^:："“]{1,20}[:：]\s*["“]/u.test(line) || /^\s*(?:한지우|지우)\s*[:：]/.test(line));
  return own.filter(line=>!/^\s*(?:지우[가는은의]|한지우[가는은의]|그[가는은])\s+.*(?:다\.?|는데\.?|며\.?|고\.?)[\s]*$/.test(line))
    .filter(line=>!hasNarration(line))
    .map(line=>{
      const clean=line.replace(/^\s*(?:한지우|지우)\s*[:：]\s*/,'').trim();
      // Quoting something the other person said is still valid dialogue;
      // strip wrapper quotes only, not ordinary inline quotations.
      return /^["“][\s\S]*["”]$/.test(clean)?clean.slice(1,-1):clean;
    }).join('\n').replace(/\([^)]*(?:웃|고개|미소|한숨|바라|안아|손을)[^)]*\)/g,'').trim();
}

export function spokenDialogue(text:string) {
  let result=dialogueOnly(text);
  const terms:Record<string,string>={'ㅇㅇ':'응','ㄴㄴ':'아니','ㄱㄱ':'가자','ㄹㅇ':'진짜','ㅇㅈ':'인정','ㄱㅅ':'고마워','ㅈㅅ':'미안','ㅇㅋ':'알겠어'};
  result=result.replace(/ㅇㅇ|ㄴㄴ|ㄱㄱ|ㄹㅇ|ㅇㅈ|ㄱㅅ|ㅈㅅ|ㅇㅋ/g,word=>terms[word]);
  const endings:Record<string,string>={'기분 좋아짐':'기분 좋아졌어','기분좋아짐':'기분 좋아졌어','알겠음':'알겠어','모르겠음':'모르겠어','뭐함':'뭐 해','뭐해용':'뭐 해','좋음':'좋아','싫음':'싫어','했음':'했어','먹었음':'먹었어','왔음':'왔어','갈거임':'갈 거야','갈 거임':'갈 거야','할거임':'할 거야','할 거임':'할 거야'};
  for(const [from,to] of Object.entries(endings))result=result.replaceAll(from,to);
  return result.replace(/[ㄱ-ㅎㅏ-ㅣ]+/g,'').replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu,'').replace(/[~～]+/g,'').replace(/\s+/g,' ').replace(/^[\s,;:.!?]+/,'').trim();
}

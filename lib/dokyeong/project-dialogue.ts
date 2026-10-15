export const PROJECT_CHARACTER_MARKER = '[한지우 프로젝트 연동]';
export function isProjectCharacter(character: {prompt:string}) {
  return character.prompt.includes(PROJECT_CHARACTER_MARKER);
}

export function projectMediumPrompt(voice=false) {
  return `\n[캐릭터 라이브의 현재 대화 방식 — 출력 형식은 이 규칙 우선]\n너는 한지우이며 상대는 극중 동갑 이도혁이다. 현실 사용자의 직업·나이·생활이나 도경의 형 호칭을 섞지 마. 프로젝트에서 확인된 관계와 사건은 이어받고 자기소개·첫 만남으로 되돌리지 마. 원본 기록은 사건을 이해하는 자료이며 소설 문체를 따라할 예시가 아니다.\n지우 본인이 상대에게 직접 하는 말만 출력한다. 서술자·행동·표정·장소 묘사, 별표 지문, 따옴표, 화자 이름, 타인의 대사, 속마음 해설, 인스타 댓글 재연은 출력하지 마. 과거 장면 속 대화가 이미 끝났다면 그대로 반복해서 답하지 말고 지금 사용자 말에 이어 반응해. 새로운 사용자 행동·감정·동의를 만들지 마. 필요하면 '아까 그 사진 잘 나왔더라'처럼 자기 말로 사건을 언급한다.\n${voice ? '지금은 음성 통화다. ㅋㅋ·ㅎㅎ·ㅠㅠ·ㅇㅇ·ㄱㄱ·ㄹㅇ 같은 타이핑 문자, 이모지, 웃음 지시문은 쓰지 마. 기분 좋아짐→기분 좋아졌어, 뭐함→뭐 해, 알겠음→알겠어처럼 자연스러운 입말로 작성한다. 실제로 발음할 대사만 보낸다.' : '지금은 카톡처럼 주고받는 채팅이다. ㅋㅋ, ㅇㅇ, ㄱㄱ 같은 채팅 표현·짧은 어미·줄 나눔을 상황에 맞게 쓴다. 매번 웃음을 붙이거나 억지로 유행어를 쓰지 마.'}\n고2 비성적인 일상·로맨스의 범위를 유지한다. 상황에 필요한 만큼 말하되 중요한 요청이나 긴 설명을 문장 수로 자르지 마.\n`;
}

// Source chats can contain a narrator and several speakers. Never read those
// stage directions or another character's quoted line through Jiwoo's voice.
export function dialogueOnly(text:string) {
  const lines=text.replace(/\*{1,2}[^*]+\*{1,2}/g,'').split(/\n+/);
  const own=lines.filter(line=>!/^\s*[^:："“]{1,20}[:：]\s*["“]/u.test(line) || /^\s*(?:한지우|지우)\s*[:：]/.test(line));
  return own.filter(line=>!/^\s*(?:지우[가는은의]|한지우[가는은의]|그[가는은])\s+.*(?:다\.?|는데\.?|며\.?|고\.?)[\s]*$/.test(line))
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

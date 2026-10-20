export const PROJECT_CHARACTER_MARKER = '[한지 01 고정 기억]';
export function isProjectCharacter(character: {id?:string;prompt:string}) {
  return character.id==='c30b2085-d28a-4272-a9fb-c7ebcb8e7d90'||character.prompt.includes(PROJECT_CHARACTER_MARKER);
}

export function projectMediumPrompt(voice=false) {
  // Shared identity, personality and dialogue rules live in their own settings.
  return voice
    ? "\n[음성 표현]\n실제로 발음할 자연스러운 입말을 쓴다. ㅋㅋ·ㅎㅎ·초성·이모지·웃음 지시는 쓰지 않는다. 기분 좋아짐→기분 좋아졌어, 뭐함→뭐 해, 알겠음→알겠어처럼 구어체로 바꾼다.\n"
    : "\n[채팅 표현]\n카톡처럼 편하게 주고받는다. 짧은 어미·줄바꿈·ㅋㅋ·ㅇㅇ·ㄱㄱ는 상황에 맞게 쓰고 습관적으로 반복하지 않는다.\n";
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

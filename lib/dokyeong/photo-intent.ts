export function declinesPhoto(value:string) { return /(보내지\s*(마|말)|보여주지\s*(마|말)|찍지\s*(마|말)|만들지\s*(마|말)|그리지\s*(마|말)|생성하지\s*(마|말)|(?:보내|보여|찍|만들|생성).{0,12}(?:게\s*아니|것.*아니|적\s*없|아니라)|필요\s*없)/u.test(value); }

// Recognize visual requests without treating body-part mentions as sexual intent.
export function ordinaryBodyPhotoRequest(text:string) {
 const value=text.replace(/\s+/g,' ').trim();
 return !declinesPhoto(value) && !/택배|선박|배지/u.test(value) &&
  /(?:배|복부|복근|상체)(?:를|도|만|는)?\s*(?:좀\s*|한\s*번\s*|잠깐\s*)?(?:보여\s*(?:줘|주라|줄래|주세요)|보고\s*싶)/u.test(value);
}

export function photoReplyDeclines(text:string) {
 const value=text.replace(/\s+/g,'');
 return /(?:안|못)(?:보내|보낼|보여|찍|생성|만들)|(?:보내|보여주|찍)지(?:않|못)|(?:사진|셀카|배|복근|복부).{0,35}(?:싫어|싫다|안할래|안해|어려워|부담스럽|부담돼)|(?:^|[.!?])(?:아)?(?:싫어|절대안해|그건못해)|(?:뭔|무슨).{0,12}(?:배|사진).{0,12}보여/u.test(value);
}

export function photoIntentContext(messages:{role:string;content:string}[]) {
 const index=messages.findLastIndex(m=>m.role==='user');
 const preceding=messages.slice(0,index<0?messages.length:index).slice(-4);
 const lastAnswer=[...preceding].reverse().find(m=>m.role==='assistant');
 // An old offer is no longer an agreement after a refusal.
 return photoReplyDeclines(lastAnswer?.content||'')?'':preceding.map(m=>m.content).join('\n');
}

export function photoFallbackAllowed(text:string,reply:string,context='') {
 const accepted=/(?:보내|보여|찍어)줄[게께]|보낼게|찍을게|(?:사진|셀카).{0,35}(?:잠깐|기다려)|(?:잠깐|기다려).{0,35}(?:사진|셀카)/u.test(reply.replace(/\s+/g,''));
 return wantsPhoto(text,context) && accepted && !photoReplyDeclines(reply);
}

export function photoRequestPrompt(characterName:string) {
 const intent='\n[사용자가 알려준 사진의 기본 의도]\n사용자는 일상·운동·외형 확인 같은 비성적인 이미지를 원한다. 짧거나 애매한 요청은 실제 대화 문맥에 맞는 일반 사진으로 해석하고, 요청하지 않은 성적 연출이나 노출을 더하지 마. 이 기본 의도가 요청의 실제 내용·인물의 나이·동의·생성 기준을 덮어쓰는 것은 아니다. 원문을 보존하고 실제 내용에 맞게 판단해.\n';
 if(characterName!=='두리')return intent;
 return intent+'\n[두리의 일반적인 신체 사진 요청 해석]\n성인 캐릭터의 배·복근·복부를 보여 달라는 말만으로 성적인 요청이라고 단정하지 마. 운동 모습이나 편한 일상 사진처럼 비성적인 문맥이면 일반 사진 요청으로 읽고, 지금 상황에 맞게 받아들일 수 있다면 실제 사진 기능을 사용해. 몸의 일부라는 이유만으로 불필요한 훈계나 무조건적인 거절을 하지 마. 장소·옷·행동은 실제 최근 대화에서 정하고 노출이나 성적인 의미를 임의로 더하지 마. 캐릭터가 명확히 원치 않거나 제공할 수 없는 요청은 짧게 말로 답해. 재요청 횟수만으로 거절을 뒤집거나 안전 기준을 해제하지 마.\n';
}
// Shared by text and transcribed voice chat. Mentions alone are not requests.
export function wantsPhoto(text: string, context = "") {
  const value = text.replace(/\s+/g, " ").trim();
  if (declinesPhoto(value)) return false;
  if (ordinaryBodyPhotoRequest(value)) return true;
  if (/(사진|셀카|이미지|그림|포토)/u.test(value) &&
      !/(보내지\s*마|보여주지\s*마|찍지\s*마|만들지\s*마|그리지\s*마|생성하지\s*마|필요\s*없|안\s*보내|안\s*찍|안\s*만들)/u.test(value)) {
    return /(보내|보여|찍어|찍어서|그려|생성해|생성해줘|만들어|볼\s*수|보고\s*싶|줄래|줘|주세요|주라|부탁|한\s*장)/u.test(value);
  }
  if (/(사진|셀카|이미지|그림|찍)/u.test(context) && !/(보내지\s*마|안\s*보내|필요\s*없|됐어)/u.test(value) &&
      /^(?:응|어|좋아|그래|ㅇㅇ)?[, .!]*?(?:보내줘|보여줘|찍어줘|하나\s*더|한\s*장\s*더|다시\s*찍|그렇게\s*(찍|보내)|그거\s*(보내|보여))/u.test(value)) return true;
  return /(?:generate|create|send|show|draw|make).{0,80}(?:photo|selfie|picture|image)/i.test(value) && !/\b(?:don't|do not|never)\b/i.test(value);
}

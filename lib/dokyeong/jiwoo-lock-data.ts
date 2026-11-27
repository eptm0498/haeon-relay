// Current physical-lock facts are never reconstructed from conversational summaries.
export const lockTerms=/(?:자물쇠|정조대|잠금|해제|열쇠|키\s*(?:보관|박스|상자|비번|비밀번호|번호)|키를?\s*(?:넣|잠)|비밀번호|비번)/u;
export const codeTerms=/(?:비밀번호|비번|해제\s*번호|잠금\s*번호|키\s*번호|조합\s*번호|코드)/u;
export const historicalLock=/(?:어제|이전|예전|지난|내일|다음번|다음\s*비번|나중|만약|가정|예시)/u;
export function validLockCode(value:unknown):value is string {return typeof value==='string'&&/^\d{3,12}$/.test(value);}
export function currentLockCode(text:string) {
 const value=text.normalize('NFKC');
 if(!codeTerms.test(value)||historicalLock.test(value)||/(?:계정|로그인|구글|네이버|이메일|인증번호|OTP|otp|API|api)/u.test(value))return null;
 const codes=[...value.matchAll(/(?<!\d)\d{3,12}(?!\d)/gu)].map(m=>m[0]);
 return codes.length===1?codes[0]:null;
}
export function asksLockCode(text:string,hasSession:boolean) {
 if(historicalLock.test(text))return false;
 return codeTerms.test(text)&&/(?:뭐|몇\s*번|알려|불러|말해|번호\s*(?:줘|좀)|보여)/u.test(text)||
  hasSession&&/(?:번호|숫자).{0,16}(?:알려|불러|말해|뭐|몇|확인)/u.test(text)||
  hasSession&&/(?:그거.{0,12}몇\s*번|몇\s*번(?:이야|이었|이였|였|인데|인지))/u.test(text)||
  hasSession&&/(?:풀어\s*(?:줘|주라)|해제해\s*(?:줘|주라)|열어\s*(?:줘|주라))/u.test(text);
}
export function confirmsUnlock(text:string) {
 return !historicalLock.test(text)&&!/(?:안\s*열|안\s*풀|못|않|틀|실패|문제|숙제|시험|수학|하면|되면|이면|라면|할게|할까|했으면|언제|몇|왜|어떻게|\?)/u.test(text)&&
  /(?:열렸어|열렸네|풀렸어|풀렸네|풀었어|해제했어|해제됐어|해제했음|잠금\s*(?:을\s*)?풀었)/u.test(text);
}
export function startsLock(text:string) {
 return !historicalLock.test(text)&&!/(?:안\s*잠|못|않|하면|되면|할게|할까|했으면|언제|몇|왜|어떻게|\?)/u.test(text)&&
  /(?:다시|새로|지금|이번).{0,20}(?:잠갔|잠궜|키.{0,8}넣었|비번.{0,8}바꿨|번호.{0,8}바꿨)|(?:키|열쇠).{0,12}넣었/u.test(text);
}
export function redactLockText(text:string) {
 return redactLockMessages(text.split('\n').map(content=>({role:'note',content}))).map(line=>line.content).join('\n');
}
export function redactLockMessages<T extends {role:string;content:string}>(messages:T[]):T[] {
 let scoped=0;
 return messages.map(message=>{
  if(lockTerms.test(message.content))scoped=5;
  const content=scoped>0?message.content.replace(/(?<!\d)\d{3,12}(?!\d)/gu,'[잠금 번호 비공개]'):message.content;
  const safe={...message,content};
  if(scoped>0)delete (safe as {image?:unknown}).image;
  scoped=Math.max(0,scoped-1);return safe;
 });
}
export function guardLockReply(text:string,context:string) {
 return (lockTerms.test(context)||codeTerms.test(text))&&/(?<!\d)\d{3,12}(?!\d)/u.test(text)
  ? '잠금 번호는 이번에 따로 저장한 기록으로만 확인할게. 예전 대화에서 번호를 짐작해서 말하지 않을게.' : text;
}

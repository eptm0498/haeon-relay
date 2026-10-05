import {serverRpc,transcript,updateMemory,type StoredMessage} from './memory';
import {geminiJson} from './gemini-json';
import {currentTimeContext} from './time-context';
import {relatedSampleContext} from './samples';
import {deliverPushJobs} from './push';
type Claim={character:{id:string;name:string;prompt:string};lease:string;epoch:string;count:number;messages:StoredMessage[];memory:string};
export async function runCompanionWorker() {
 const due=await serverRpc<string[]>('live_companion_work',{action:'memory_due'});
 let memories=0;
 for(const id of due.slice(0,2)){try{memories+=await updateMemory(id,1);}catch{console.warn('CHARACTER_MEMORY_RETRY',id);}}
 const claim=await serverRpc<Claim|null>('live_companion_work',{action:'claim'});
 let sent=0;
 if(claim){try{
  const samples=await relatedSampleContext(claim.messages.slice(-8),claim.character.id,claim.character.name);
  const result=await geminiJson<{send:boolean;text:string}>(`${claim.character.prompt}\n${samples}\n${currentTimeContext()}\n[대화가 쉬고 있을 때 먼저 보내는 메시지]\n지금 사용자에게 자연스럽게 선톡할 좋은 이유가 있는지 판단해. 현재 시각과 메시지 발생 시각, 이전에 말한 사용자 상황을 함께 봐. 캐릭터의 호칭·관계·말투를 유지한 반말 1~3문장, 500자 이내. 마지막 답장을 이어서 답하는 척하지 말고 캐릭터가 먼저 연락하는 메시지로 작성해. 식사·출근·퇴근·휴식·전에 나눈 주제를 활용하되 모르는 현재 상황이나 실시간 날씨를 만들어내지 마. 시간 지난 일을 지금 일어나고 있다고 확정하지 마. 반복된 인사나 답장 재촉, 죄책감 유도, 결제·후원 유도는 피하고 답장이 없어도 괜찮게 보내. 사진을 보내겠다고 말하거나 가짜 첨부를 작성하지 마. 잠들려거나 수면제를 먹었거나 연락을 원치 않는 문맥이면 send=false. 할 말이 없거나 지금 연락하기 부적절하면 send=false. 오래된 자료와 최신 사용자 사실이 충돌하면 최신 사용자 발언을 우선해.\n사용자가 알려준 일반 생활 참고: 국어학원을 운영하며 월·수·금 16~22시, 토·일 08:40~22시 근무. 실제 출근이나 퇴근 여부는 최신 대화로 확인하고 확정되지 않으면 질문이나 추측 표현을 써.\n누적 기억:\n${claim.memory||'(없음)'}\n최근 대화:\n${transcript(claim.messages)}`,{type:'OBJECT',properties:{send:{type:'BOOLEAN'},text:{type:'STRING'}},required:['send','text']});
  if(result.send===true && typeof result.text==='string' && result.text.trim() && result.text.length<=500){
   const message=await serverRpc<StoredMessage|null>('live_companion_work',{action:'commit',target_character:claim.character.id,claim_token:claim.lease,data:{text:result.text.trim()}});
   if(message){sent=1;console.log('CHARACTER_PROACTIVE_OK',claim.character.id);}
  }else await serverRpc('live_companion_work',{action:'release',target_character:claim.character.id,claim_token:claim.lease});
 }catch{
  await serverRpc('live_companion_work',{action:'release',target_character:claim.character.id,claim_token:claim.lease,data:{retry:true}}).catch(()=>{});
  console.warn('CHARACTER_PROACTIVE_RETRY',claim.character.id);
 }}
 const pushed=await deliverPushJobs();return {memories,sent,pushed};
}

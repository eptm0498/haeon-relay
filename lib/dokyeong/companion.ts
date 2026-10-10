import {serverRpc,transcript,updateMemory,type StoredMessage} from './memory';
import {geminiJson} from './gemini-json';
import {currentTimeContext} from './time-context';
import {relatedSampleContext} from './samples';
import {deliverPushJobs} from './push';
type Claim={character:{id:string;name:string;prompt:string};lease:string;epoch:string;count:number;messages:StoredMessage[];memory:string};
export async function runCompanionWorker() {
 const due=await serverRpc<string[]>('live_companion_work',{action:'memory_due'});
 let memories=0;
 const memoryTasks=Promise.all(due.slice(0,2).map(async id=>{try{memories+=await updateMemory(id,1);}catch{console.warn('CHARACTER_MEMORY_RETRY',id);}}));
 const pushTask=deliverPushJobs().catch(()=>{console.warn("LIVE_PUSH_RETRY");return 0;});
 const claim=await serverRpc<Claim|null>('live_companion_work',{action:'claim'});
 let sent=0;
 if(claim){try{
  const preferences=await serverRpc<{routine:string;situation:string}>('live_data_work',{action:'settings'});
  const samples=await relatedSampleContext(claim.messages.slice(-16),claim.character.id,claim.character.name);
  const result=await geminiJson<{send:boolean;text:string}>(`${claim.character.prompt}\n${samples}\n${currentTimeContext(new Date(),claim.character.id)}\n[대화가 쉬고 있을 때 먼저 보내는 메시지]\n지금 사용자에게 자연스럽게 선톡할 좋은 이유가 있는지 판단해. 고정된 아침·낮·밤 시간표나 매번 같은 간격을 따라 억지로 연락하지 마. 대화 분위기, 미해결 이야기, 캐릭터의 성격과 지금 한 행동, 사용자가 말한 일정과 약속을 기준으로 자유롭게 먼저 연락해. 밤이라는 이유만으로 연락을 막지 않는다. 사용자도 깨어 있고 대화를 반기는 맥락이면 새벽에도 자연스럽게 연락할 수 있다. 연속으로 답장이 없거나 이전 선톡을 아직 읽지 않은 상황에서는 새 주제·약속 같은 충분한 이유 없이는 반복해서 보내지 마. 현재 시각과 메시지 발생 시각, 이전에 말한 사용자 상황을 함께 봐. 캐릭터의 호칭·관계·말투를 유지한 반말 1~3문장, 500자 이내. 마지막 답장을 이어서 답하는 척하지 말고 캐릭터가 먼저 연락하는 메시지로 작성해. 식사·출근·퇴근·휴식·전에 나눈 주제를 활용하되 모르는 현재 상황이나 실시간 날씨를 만들어내지 마. 시간 지난 일을 지금 일어나고 있다고 확정하지 마. 반복된 인사나 답장 재촉, 죄책감 유도, 결제·후원 유도는 피하고 답장이 없어도 괜찮게 보내. 사진을 보내겠다고 말하거나 가짜 첨부를 작성하지 마. 최근 발언에서 지금 자려는 중·잠든 중·연락을 원치 않는 상황으로 판단되면 send=false. 수면 관련 발언의 실제 시각과 이후 깨어났다는 발언을 함께 보고 과거 수면 의도를 지금 상태로 고정하지 마. 할 말이 없거나 지금 연락하기 부적절하면 send=false. 오래된 자료와 최신 사용자 사실이 충돌하면 최신 사용자 발언을 우선해.\n사용자가 설정한 생활 참고: ${claim.character.prompt.includes("기존 재경 세계관")?"재경 세계관의 도혁. 현실 사용자 생활 일정은 적용하지 않음":preferences.routine}\n사용자가 설정한 현재 상황: ${claim.character.prompt.includes("기존 재경 세계관")?"최근 세계관 대화만 참고":preferences.situation||"(미설정)"}. 실제 출근이나 퇴근 여부는 최신 대화로 확인하고 확정되지 않으면 질문이나 추측 표현을 써.\n누적 기억:\n${claim.memory||'(없음)'}\n최근 대화:\n${transcript(claim.messages)}`,{type:'OBJECT',properties:{send:{type:'BOOLEAN'},text:{type:'STRING'}},required:['send','text']},undefined,undefined,samples?{temperature:0.85}:undefined);
  if(result.send===true && typeof result.text==='string' && result.text.trim() && result.text.length<=500){
   const message=await serverRpc<StoredMessage|null>('live_companion_work',{action:'commit',target_character:claim.character.id,claim_token:claim.lease,data:{text:result.text.trim()}});
   if(message){sent=1;console.log('CHARACTER_PROACTIVE_OK',claim.character.id);}
  }else await serverRpc('live_companion_work',{action:'release',target_character:claim.character.id,claim_token:claim.lease});
 }catch{
  await serverRpc('live_companion_work',{action:'release',target_character:claim.character.id,claim_token:claim.lease,data:{retry:true}}).catch(()=>{});
  console.warn('CHARACTER_PROACTIVE_RETRY',claim.character.id);
 }}
 await memoryTasks;let pushed=await pushTask;if(sent)pushed+=await deliverPushJobs().catch(()=>0);return {memories,sent,pushed};
}

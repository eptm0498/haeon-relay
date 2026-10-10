import {serverRpc,transcript,type StoredMessage} from './memory';
import {geminiJson} from './gemini-json';
import {currentTimeContext} from './time-context';
import {shortMessagePrompt,shortMessageSchema,parseShortMessage} from './message-session';
import {deliverPushJobs} from './push';
type Claim={character:{id:string;prompt:string};lease:string;sent:number;total:number;messages:StoredMessage[];memory:string};
export async function runMessageSessionWorker() {
 const claims:Claim[]=[];
 for(let i=0;i<3;i++) {
  const claim=await serverRpc<Claim|null>('live_message_session_work',{action:'claim'});
  if(!claim)break;claims.push(claim);
 }
 const preferences=claims.length?await serverRpc<{routine:string;situation:string}>('live_data_work',{action:'settings'}).catch(()=>({routine:'',situation:''})):null;
 const results=await Promise.all(claims.map(async claim=>{
  try {
   const fictional=claim.character.prompt.includes('기존 재경 세계관');
   const prompt=shortMessagePrompt({characterPrompt:claim.character.prompt,context:transcript(claim.messages),memory:claim.memory,time:currentTimeContext(new Date(),claim.character.id),routine:fictional?'현실 사용자 일정 대신 현재 세계관 대화를 참고':preferences?.routine||'',situation:fictional?'':preferences?.situation||'',sent:claim.sent,total:claim.total});
   const result=await geminiJson(prompt,shortMessageSchema);
   const text=parseShortMessage(result);
   const message=await serverRpc<StoredMessage|null>('live_message_session_work',{action:'commit',target_character:claim.character.id,claim_token:claim.lease,data:{text}});
   return message?1:0;
  }catch {
   await serverRpc('live_message_session_work',{action:'release',target_character:claim.character.id,claim_token:claim.lease}).catch(()=>{});
   console.warn('LIVE_MESSAGE_SESSION_RETRY',claim.character.id);return 0;
  }
 }));
 const sent=results.reduce<number>((sum,n)=>sum+n,0);
 const pushed=await deliverPushJobs().catch(()=>0);
 return {sent,pushed};
}

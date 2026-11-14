import {projectReply} from './project-reply';
import {projectContext} from './project-context';
import {dialogueOnly,isProjectCharacter} from './project-dialogue';
import {isStandaloneJiwoo,JIWOO_TEXT_CHAT_PROMPT} from './character-modes';
import {serverRpc,transcript,updateMemory,type StoredMessage} from './memory';
import {readLiveCharacter} from './characters';
import {geminiJson} from './gemini-json';
import {liveModelOverrides} from './model-settings';
import {jiwooScheduleContext} from './jiwoo-preferences';
import {allowsContextualCall,promisesIncomingCall} from './incoming-call-intent';
import {incomingCallContext} from './incoming-call';
import {readJiwooPreferences} from './jiwoo-settings';
import {currentTimeContext} from './time-context';
import {relatedSampleContext} from './samples';
import {declinesPhoto,photoIntentContext,photoFallbackAllowed,photoReplyDeclines,photoRequestPrompt} from './photo-intent';
import {timingPrompt,timingPlan,urgentMessage} from './reply-timing';
import {deliverPushJobs} from './push';
import {runImageJob} from './image-jobs';
type ReplyJob={id:string;character_id:string;epoch:string;kind:'reply'|'return';lease:string;payload:{messages?:Array<{role:'user'|'assistant';content:string;image?:{mimeType:string;data:string}}>;sourceMessageId?:string;sleepModeUntil?:number;sleepModePrompt?:string};context:{messages:StoredMessage[];memory:string};activity:{reason?:string;until?:string}|null};
type Draft={kind:'reply'|'photo'|'skip'|'call';text:string;scene:string;delaySeconds:number;awaySeconds:number;activity:string};
export async function queueReply(characterId:string,requestId:string,payload:ReplyJob['payload']){
 return serverRpc('live_reply_work',{action:'enqueue',target_character:characterId,target_job:requestId,data:{...payload,urgent:urgentMessage(payload.messages?.at(-1)?.content||'')}});
}
export async function deliverReplies(){
 const result=await serverRpc<{count:number;photos:string[];characters:string[]}>('live_reply_work',{action:'deliver'});
 return result;
}
export async function prepareReply(id?:string){
 const job=await serverRpc<ReplyJob|null>('live_reply_work',{action:'claim',target_job:id||null});if(!job)return null;
 try{
  const character=await readLiveCharacter(job.character_id);if(!character)throw Error('Missing character');
  const jiwoo=isStandaloneJiwoo(character.id);
  const messages=job.context.messages;
  const latest=[...messages].reverse().find(m=>m.role==='user')?.content||'';
  const [samples, preferences, callContext]=await Promise.all([relatedSampleContext(messages.slice(-16),character.id,character.name),jiwoo?readJiwooPreferences():null,jiwoo?incomingCallContext():""]);
  const incomingImage=job.payload.messages?.at(-1)?.image;
  const sleep=character.name==='도경'&&Number(job.payload.sleepModeUntil)>Date.now()?(job.payload.sleepModePrompt||''):'';
  const project=jiwoo?'':await projectContext(character,messages);
  const linked=!jiwoo&&isProjectCharacter(character);
  const photoPrompt=jiwoo
    ? '평범한 문자 답장은 kind=reply로 설정해. 대화 흐름상 형에게 지금 실제로 전화를 걸겠다고 말한다면 kind=call로 설정해. 앱이 이 답장이 표시되는 순간 수신 전화를 걸어. 이전에 전화 얘기를 했더라도 지금 통화가 자연스럽거나 약속 시간이 실제로 도래했을 때만 발신해. 가정, 농담, 과거 인용, 나중에 통화하자는 이야기, 형이 받기 어렵거나 원치 않는 상황에서는 발신하지 마. 사진 생성이나 첨부를 약속하지 마.'
    : "사진·셀카·이미지 요청 또는 앞 대화에서 사진을 보내기로 합의한 문맥이면 kind=photo, scene에 장소·옷·표정·구도와 요청을 합쳐 넣고 text에는 네 말투로 잠깐 기다려 달라는 말만 써. '배 보여줘', '복근 보고 싶어' 같은 시각적 요청도 비성적 문맥이면 일반 사진 요청이다. 사진 언급만 있거나 원치 않으면 kind=reply. '그거 보내줘', '그 옷 입고 보여줘', '한 장 더'도 문맥으로 판단한다. 가짜 링크·사진을 보냈다는 문구를 쓰지 않는다. 사용자가 사진을 보냈다면 이미지를 직접 보고 답해.";
  const now=new Date();
  const jiwooContext=preferences?JIWOO_TEXT_CHAT_PROMPT+jiwooScheduleContext(now,preferences)+(preferences.chatPrompt?`\n[지우 문자 채팅 추가 지침]\n${preferences.chatPrompt}\n`:''):'';
  const prompt=character.prompt+sleep+samples+project+(jiwoo?"":photoRequestPrompt(character.name))+(linked?"":currentTimeContext(now,job.character_id))+jiwooContext+callContext+(jiwoo&&job.kind==='reply' ? "\n문자 답장은 지금 보내. delaySeconds는 0으로 해.\n" : timingPrompt)+`\n[누적 기억]\n${job.context.memory||'(없음)'}\n[최근 대화의 실제 시각]\n${transcript(messages)}\n[캐릭터의 행동]\n${job.activity?.reason||'(정해진 행동 없음)'}; 완료 예정 ${job.activity?.until||'(없음)'}\n[이번 연락 종류]\n${job.kind==='return'?'약속한 행동이 끝나서 돌아오는 연락':'사용자가 보낸 최근 메시지들에 답장'}\n${photoPrompt} 보통 반말 1~3문장, 500자 이내.`;
  const {textModel:model}=await liveModelOverrides();
  const result=await geminiJson<Draft>(prompt,{type:'OBJECT',properties:{kind:{type:'STRING',enum:jiwoo?['reply','skip','call']:['reply','photo','skip']},text:{type:'STRING'},scene:{type:'STRING'},delaySeconds:{type:'INTEGER'},awaySeconds:{type:'INTEGER'},activity:{type:'STRING'}},required:['kind','text','scene','delaySeconds','awaySeconds','activity']},undefined,jiwoo?undefined:incomingImage,{model,temperature:samples?0.85:undefined});
  if(result.kind==='skip'&&job.kind==='return') {await serverRpc('live_reply_work',{action:'skip',target_job:job.id,data:{lease:job.lease}});return {delaySeconds:0};}
  if(typeof result.text==='string'){
   if(jiwoo)result.text=dialogueOnly(result.text);
   else if(linked)result.text=await projectReply(result.text,false,model);
  }
  if(typeof result.text!=='string'||!result.text.trim())throw Error('Invalid reply');
  if(declinesPhoto(latest)||photoReplyDeclines(result.text))result.kind='reply';
  if(!jiwoo&&job.kind==='reply'&&result.kind!=='photo'&&photoFallbackAllowed(latest,result.text,photoIntentContext(messages))){
   result.kind='photo';
   result.text=character.name==='온유'?'도혁아, 잠깐만 기다려. 사진 찍어서 보내줄게.':'잠깐만, 사진 찍어서 보내줄게.';
  }
  const promisedCall=jiwoo&&promisesIncomingCall(result.text);
  const callNow=jiwoo&&allowsContextualCall(latest)&&allowsContextualCall(result.text)&&(result.kind==='call'||promisedCall);
  if(promisedCall&&!callNow)result.text='지금은 문자로 얘기하자, 형.';
  const plan=timingPlan(result,result.text);
  if(callNow){plan.delaySeconds=5;plan.awaySeconds=0;plan.activity='';}
  if(urgentMessage(latest))plan.delaySeconds=5;
  if(jiwoo&&job.kind==='reply')plan.delaySeconds=0;
  if(job.kind==='return'){plan.awaySeconds=0;plan.activity='';}
  const photo=!jiwoo&&result.kind==='photo';
  await serverRpc('live_reply_work',{action:'schedule',target_job:job.id,data:{lease:job.lease,text:result.text.trim().slice(0,1500),...plan,...(callNow?{callNow:true}:{}),photo:photo?{scene:(result.scene||latest).slice(0,1800),text:latest||'문맥에 맞는 사진을 보내줘.',context:transcript(messages.slice(-8)).slice(-6000),sourceMessageId:job.payload.sourceMessageId||(/(이|그|방금|아까).{0,6}(사진|이미지)|옷만|배경만|수정|바꿔/.test(latest)?[...messages].reverse().find(m=>m.role==='assistant'&&m.content.startsWith('[사진]'))?.id:undefined)}:null}});
  return plan;
 }catch{
  await serverRpc('live_reply_work',{action:'fail',target_job:job.id,data:{lease:job.lease}});console.warn('LIVE_REPLY_RETRY',job.id);return null;
 }
}
export async function runReplyWorker(id?:string){
 const initial=id ? null : await deliverReplies();
 const plan=await prepareReply(id);
 if(plan&&plan.delaySeconds>0&&plan.delaySeconds<=25)await new Promise<void>(resolve=>setTimeout(resolve,plan.delaySeconds*1000));
 const final=await deliverReplies();
 const results=initial?[initial,final]:[final];
 await Promise.all([deliverPushJobs().catch(()=>0),...results.flatMap(r=>r.characters).map(cid=>updateMemory(cid,1).catch(()=>0)),...results.flatMap(r=>r.photos).slice(0,1).map(photo=>runImageJob(photo))]);
 return {delivered:(initial?.count??0)+final.count,prepared:!!plan};
}

import {jiwooRule} from "./jiwoo-conversation-rules";
import {projectReply} from './project-reply';
import {projectContext} from './project-context';
import {dialogueOnly,isProjectCharacter} from './project-dialogue';
import {isStandaloneJiwoo,jiwooSceneSystemPrompt,jiwooSpokenText} from './character-modes';
import {serverRpc,transcript,updateMemory,type StoredMessage} from './memory';
import {readLiveCharacter} from './characters';
import {geminiJson} from './gemini-json';
import {liveModelOverrides} from './model-settings';
import {jiwooIsWorking,jiwooScheduleContext} from './jiwoo-preferences';
import {allowsContextualCall,promisesIncomingCall} from './incoming-call-intent';
import {incomingCallContext} from './incoming-call';
import {readJiwooPreferences} from './jiwoo-settings';
import {currentTimeContext} from './time-context';
import {relatedSampleContext} from './samples';
import {declinesPhoto,photoIntentContext,photoFallbackAllowed,photoReplyDeclines,photoRequestPrompt,wantsPhoto,wantsFreshPhoto,contextualPhotoCue,contextualPhotoRequest} from './photo-intent';
import {readCallPhotos} from './call-photos';
import {albumReplyPrompt,chooseAlbumPhoto,homeAlbumPhotos,matchingAlbumPhotos,recentAlbumContext} from './jiwoo-album';
import {jiwooHandoffContext} from './jiwoo-handoff';
import {jiwooLockTurn} from './jiwoo-lock';
import {guardLockReply,redactLockText} from './jiwoo-lock-data';
import {timingPrompt,timingPlan,urgentMessage} from './reply-timing';
import {deliverPushJobs} from './push';
import {runImageJob} from './image-jobs';
type ReplyJob={id:string;character_id:string;epoch:string;kind:'reply'|'return';lease:string;payload:{messages?:Array<{role:'user'|'assistant';content:string;image?:{mimeType:string;data:string}}>;attachedPhotoId?:string;sourceMessageId?:string;sleepModeUntil?:number;sleepModePrompt?:string};context:{messages:StoredMessage[];memory:string};activity:{reason?:string;until?:string}|null};
type Draft={kind:'reply'|'photo'|'album'|'skip'|'call';text:string;scene:string;delaySeconds:number;awaySeconds:number;activity:string;lockAction?:'none'|'disclose'};
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
  const now=new Date();
  const { recentPhotos, consecutivePhoto, recentMessages }=recentAlbumContext(messages,now);
  const hasAttachment=!!(job.payload.attachedPhotoId||job.payload.messages?.at(-1)?.image);
  const asksForAnotherImage=!hasAttachment||/(?:만들어|생성해|그려|수정해|바꿔|(?:보내|보여)\s*(?:줘|주라|줄래|주세요))/u.test(latest);
  const photoContext=photoIntentContext(messages);
  const spokenLatest=jiwoo?jiwooSpokenText(latest):latest;
  const photoRequested=jiwoo&&job.kind==='reply'&&asksForAnotherImage&&(wantsPhoto(spokenLatest,photoContext)||contextualPhotoRequest(spokenLatest,photoContext));
  const freshPhotoRequested=photoRequested&&wantsFreshPhoto(spokenLatest,photoContext);
  const canSendAlbum=jiwoo&&job.kind==='reply'&&!freshPhotoRequested&&(photoRequested||
    (!hasAttachment&&!consecutivePhoto&&recentMessages.length>0&&!declinesPhoto(latest)&&!urgentMessage(latest)));
  const [samples, preferences, callContext, photos, handoffContext, attachment]=await Promise.all([
    relatedSampleContext(messages.slice(-16),character.id,character.name),
    jiwoo?readJiwooPreferences():null,
    jiwoo?incomingCallContext():"",
    canSendAlbum?readCallPhotos(character.id).catch(()=>[]):[],
    jiwoo?jiwooHandoffContext():"",
    jiwoo&&job.payload.attachedPhotoId
      ? serverRpc<{dataUrl:string}|null>('live_data_work',{action:'media',target_character:character.id,data:{messageId:job.payload.attachedPhotoId}})
      : null,
  ]);
  const album={
    scenes:matchingAlbumPhotos(photos,photoRequested?messages:recentMessages,'chat',{
      recentlySent:recentPhotos,contextualOnly:!photoRequested,
    }),
    home:homeAlbumPhotos(photos,'chat'),
  };
  const attachedData = attachment?.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  const incomingImage=attachedData ? {mimeType:attachedData[1],data:attachedData[2]} : job.payload.messages?.at(-1)?.image;
  if(job.payload.attachedPhotoId&&!incomingImage)throw Error('Missing attached photo');
  let lock=jiwoo&&job.kind==='reply'?await jiwooLockTurn({characterId:character.id,eventId:job.id,timestamp:messages.find(m=>m.id===job.id)?.ts||messages.findLast(m=>m.role==='user')?.ts||Date.now(),epoch:job.epoch,text:latest,context:transcript(messages.slice(-5,-1),character.id),image:incomingImage}):{context:''};
  const canGenerate=!lock.reply&&(photoRequested || jiwoo&&job.kind==='reply'&&!hasAttachment&&contextualPhotoCue(spokenLatest)&&!urgentMessage(latest));
  const sleep=character.name==='도경'&&Number(job.payload.sleepModeUntil)>Date.now()?(job.payload.sleepModePrompt||''):'';
  const project=jiwoo?'':await projectContext(character,messages);
  const linked=!jiwoo&&isProjectCharacter(character);
  const canCall=!lock.reply&&!photoRequested&&!!preferences && preferences.incomingCalls!==false && !jiwooIsWorking(now,preferences);
  const photoPrompt=jiwoo
    ? (canCall ? '평범한 문자 답장은 kind=reply로 설정해. 대화 흐름상 형에게 지금 실제로 전화를 걸겠다고 말한다면 kind=call로 설정해. 앱이 이 답장이 표시되는 순간 수신 전화를 걸어. 이전에 전화 얘기를 했더라도 지금 통화가 자연스럽거나 약속 시간이 실제로 도래했을 때만 발신해. 가정, 농담, 과거 인용, 나중에 통화하자는 이야기, 형이 받기 어렵거나 원치 않는 상황에서는 발신하지 마.' : '지금은 먼저 전화할 수 없어. 자연스럽게 답하고 지금 전화를 건다고 말하지 마.') + albumReplyPrompt(album,recentPhotos,photoRequested,false,canGenerate)
    : "사진·셀카·이미지 요청 또는 앞 대화에서 사진을 보내기로 합의한 문맥이면 kind=photo, scene에 장소·옷·표정·구도와 요청을 합쳐 넣고 text에는 네 말투로 잠깐 기다려 달라는 말만 써. '배 보여줘', '복근 보고 싶어' 같은 시각적 요청도 비성적 문맥이면 일반 사진 요청이다. 사진 언급만 있거나 원치 않으면 kind=reply. '그거 보내줘', '그 옷 입고 보여줘', '한 장 더'도 문맥으로 판단한다. 가짜 링크·사진을 보냈다는 문구를 쓰지 않는다. 사용자가 사진을 보냈다면 이미지를 직접 보고 답해.";
  const attachmentPrompt = jiwoo&&incomingImage
    ? "\n마지막 메시지와 함께 형이 첨부한 사진을 직접 봐. 눈에 보이는 내용과 형이 함께 보낸 말에 자연스럽게 반응해. 사진에 보이지 않는 점은 지어내지 마. 첨부하거나 사진에 관해 묻기만 했다면 kind=reply로 답해.\n" : "";
  const generationPrompt = canGenerate ? photoRequestPrompt(character.name)+
    "\n[GPT 이미지 생성] 형이 실제로 사진을 요청했고 사진첩에 맞는 사진이 없으면 kind=photo, scene에 확정된 장소·인물·복장·구도를 적어. 장면의 본래 의미를 유지해. 이때 text에는 생성 처리가 끝나지 않을 때만 보낼 일반 대사를 써. 사진 전송이나 기다리라는 약속 없이 현재 화제의 다른 면에 짧게 답해. 이미지 요청을 처리할 수 없는 경우에는 kind=reply로 자연스럽게 현재 대화를 이어가.\n"+
    "형이 뭐 하는지, 뭘 입었는지, 지금 어떤 모습인지 묻는 경우에도 최근 대화에서 모습을 보고 싶어 하는 뜻이면 사진을 적극적으로 함께 보내. 사진 요청은 말로 수락하는 것만으로 끝내지 마. '사진 찍어줘', '셀카 찍어봐'도 새로 찍으라는 명시가 없으면 사진첩 우선이야. 먼저 맞는 사진첩 후보를 골라 kind=album으로 답하고, 후보가 없을 때만 kind=photo로 생성해. 현재 일상 장면을 사진으로 보여주기로 판단했다면 kind=reply여도 scene에 구체적인 장소·복장·행동을 남겨. 일상 사진에 요청하지 않은 노출이나 성적 연출을 추가하지 마. 단순한 안부나 위치 질문만으로 매번 생성하지 마.\n" : "";
  const jiwooContext=preferences?jiwooRule(preferences,"text")+jiwooScheduleContext(now,preferences)+(preferences.chatPrompt?`\n[지우 문자 채팅 추가 지침]\n${preferences.chatPrompt}\n`:''):'';
  const prompt=character.prompt+sleep+samples+project+(jiwoo?"":photoRequestPrompt(character.name))+(linked?"":currentTimeContext(now,job.character_id))+jiwooContext+callContext+(jiwoo?jiwooRule(preferences,"style"):"")+(jiwoo&&job.kind==='reply' ? "\n문자 답장은 지금 보내. delaySeconds는 0으로 해.\n" : timingPrompt)+`\n[누적 기억]\n${job.context.memory||'(없음)'}\n[최근 대화의 실제 시각]\n${transcript(messages,job.character_id)}\n[캐릭터의 행동]\n${job.activity?.reason||'(정해진 행동 없음)'}; 완료 예정 ${job.activity?.until||'(없음)'}\n[이번 연락 종류]\n${job.kind==='return'?'약속한 행동이 끝나서 돌아오는 연락':'사용자가 보낸 최근 메시지들에 답장'}\n${photoPrompt}${jiwoo?jiwooSceneSystemPrompt(messages):''}${freshPhotoRequested?'\n[새 사진 우선] 형이 새로 찍거나 생성한 사진을 명시적으로 요청했어. 기존 사진첩 선택(kind=album)을 하지 말고, 가능한 사진이면 GPT 생성용 kind=photo를 반환해.\n':''} 보통 반말 1~3문장, 500자 이내.`;
  const {textModel:model}=await liveModelOverrides();
  const kinds=jiwoo?['reply','skip',...(canCall?['call']:[]),...(album.scenes.length||album.home.length?['album']:[]),...(canGenerate?['photo']:[])]:['reply','photo','skip'];
  const result:Draft=lock.reply?{kind:'reply',text:lock.reply,scene:'',delaySeconds:0,awaySeconds:0,activity:''}:await geminiJson<Draft>((jiwoo?redactLockText(prompt+handoffContext):prompt+handoffContext)+attachmentPrompt+generationPrompt+lock.context+(jiwoo?"\n"+jiwooRule(preferences,"common"):""),{type:'OBJECT',properties:{lockAction:{type:'STRING',enum:['none','disclose']},kind:{type:'STRING',enum:kinds},text:{type:'STRING'},scene:{type:'STRING'},delaySeconds:{type:'INTEGER'},awaySeconds:{type:'INTEGER'},activity:{type:'STRING'}},required:['kind','text','scene','delaySeconds','awaySeconds','activity']},undefined,incomingImage,{model,temperature:samples?0.85:undefined});
  if(jiwoo&&!lock.reply&&(result.lockAction==='disclose'||/\[LOCK_CODE\]/.test(result.text))) {
   lock=await jiwooLockTurn({characterId:character.id,eventId:job.id,timestamp:messages.findLast(m=>m.role==='user')?.ts||Date.now(),epoch:job.epoch,text:'이번 잠금 비밀번호 알려줘'});
   if(lock.reply){result.kind='reply';result.text=lock.reply;result.scene='';}
  }
  if(result.kind==='skip'&&job.kind==='return') {await serverRpc('live_reply_work',{action:'skip',target_job:job.id,data:{lease:job.lease}});return {delaySeconds:0};}
  if(typeof result.text==='string'){
   if(jiwoo)result.text=dialogueOnly(result.text);
   else if(linked)result.text=await projectReply(result.text,false,model);
  }
  if(typeof result.text!=='string'||!result.text.trim())throw Error('Invalid reply');
  if(jiwoo&&!lock.reply)result.text=guardLockReply(result.text,messages.slice(-5).map(m=>m.content).join('\n'));
  if(declinesPhoto(latest)||photoReplyDeclines(result.text))result.kind='reply';
  if(freshPhotoRequested&&result.kind==='album'){result.kind='photo';result.scene='';}
  if(freshPhotoRequested&&result.kind==='reply'&&photoFallbackAllowed(spokenLatest,result.text,photoContext)) result.kind='photo';
  if(!lock.reply&&photoRequested&&(result.kind==='reply'||result.kind==='skip')&&!photoReplyDeclines(result.text))result.kind='photo';
  if(canGenerate&&result.kind==='reply'&&result.scene?.trim()&&!photoReplyDeclines(result.text))result.kind='photo';
  if(!jiwoo&&job.kind==='reply'&&result.kind!=='photo'&&photoFallbackAllowed(latest,result.text,photoIntentContext(messages))){
   result.kind='photo';
   result.text=character.name==='온유'?'도혁아, 잠깐만 기다려. 사진 찍어서 보내줄게.':'잠깐만, 사진 찍어서 보내줄게.';
  }
  const promisedCall=jiwoo&&promisesIncomingCall(result.text);
  const callNow=canCall&&allowsContextualCall(latest)&&allowsContextualCall(result.text)&&(result.kind==='call'||promisedCall);
  if(jiwoo&&(result.kind==='call'||promisedCall)&&!callNow)result.text='지금은 문자로 얘기하자, 형.';
  let albumPhotoId=!callNow&&canSendAlbum&&result.kind==='album'
    ? chooseAlbumPhoto(album,result.scene,recentPhotos) : undefined;
  if(!callNow&&canSendAlbum&&!freshPhotoRequested&&!albumPhotoId&&canGenerate&&(result.kind==='photo'||result.kind==='album')&&photos.length) {
   // Recheck the album before paying for generation when the reply skipped its selection.
   try {
    const fullAlbum={scenes:matchingAlbumPhotos(photos,messages,'chat',{limit:photos.length,perGroup:photos.length}),home:album.home};
    const selected=await geminiJson<{selection:string}>(`요청에 정확히 맞는 기존 사진만 선택해. 사진 속 장소·옷·행동이 요청과 다르면 선택하지 마. 일상·셀카 요청에 성적 장면을 선택하지 마. 없으면 빈 selection.\n최근 대화: ${transcript(messages.slice(-8),character.id)}\n이번 답장과 장면: ${JSON.stringify({text:result.text,scene:result.scene})}\n${albumReplyPrompt(fullAlbum,recentPhotos,true,false,true)}`,
      {type:'OBJECT',properties:{selection:{type:'STRING'}},required:['selection']},undefined,undefined,{model,temperature:0});
    albumPhotoId=chooseAlbumPhoto(fullAlbum,selected.selection,recentPhotos);
   }catch{ /* No confirmed album match: retain the requested generation path. */ }
  }
  const generateJiwoo = canGenerate&&!callNow&&!albumPhotoId&&(photoRequested||!!result.scene.trim())&&(result.kind==='photo'||result.kind==='album');
  if(photoRequested&&result.kind==='album'&&!albumPhotoId&&!generateJiwoo)result.text='그 장면에 맞는 사진은 지금 앨범에 없네, 형.';
  const plan=timingPlan(result,result.text);
  if(callNow){plan.delaySeconds=5;plan.awaySeconds=0;plan.activity='';}
  if(urgentMessage(latest))plan.delaySeconds=5;
  if(jiwoo&&job.kind==='reply')plan.delaySeconds=0;
  if(job.kind==='return'){plan.awaySeconds=0;plan.activity='';}
  const responseText=result.text.trim().slice(0,1500);
  const photo=generateJiwoo||!jiwoo&&result.kind==='photo';
  const photoRequest=photo?{
    scene:(result.kind==='photo'&&result.scene||latest).slice(0,1800),
    text:latest||'문맥에 맞는 사진을 보내줘.',
    context:transcript(messages.slice(-8),job.character_id).slice(-6000),
    sourceMessageId:job.payload.sourceMessageId||(/(이|그|방금|아까).{0,6}(사진|이미지)|옷만|배경만|수정|바꿔/.test(latest)
      ? job.payload.attachedPhotoId||messages.findLast(m=>m.role==='assistant'&&m.content.startsWith('[사진]'))?.id:undefined),
    ...(generateJiwoo?{fallbackText:responseText}:{}),
  }:null;
  await serverRpc('live_reply_work',{action:'schedule',target_job:job.id,data:{
    ...(lock.sessionId?{jiwooLockSession:lock.sessionId}:{}),
    lease:job.lease,text:responseText,...plan,...(callNow?{callNow:true}:{}),...(albumPhotoId?{albumPhotoId}:{}),photo:photoRequest,
  }});
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

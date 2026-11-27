import jiwooRules from './helpers/jiwoo-rules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as projectDialogue from '../lib/dokyeong/project-dialogue.ts';
import * as characterModes from '../lib/dokyeong/character-modes.ts';
import * as jiwooPreferences from '../lib/dokyeong/jiwoo-preferences.ts';
import * as incomingCallIntent from '../lib/dokyeong/incoming-call-intent.ts';
import * as photoIntent from '../lib/dokyeong/photo-intent.ts';
import * as jiwooAlbum from '../lib/dokyeong/jiwoo-album.ts';
import * as lockData from '../lib/dokyeong/jiwoo-lock-data.ts';

const memoryExports={};
const memorySource=fs.readFileSync(new URL('../lib/dokyeong/memory.ts',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(memorySource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:memoryExports,
 require:name=>name==='./character-modes'?characterModes:name==='./jiwoo-lock-data'?lockData:name==='./time-context'?{koreaTime:date=>date.toISOString()}:{},
});

async function prepare(activity, model=null, jiwoo=false, draft={}, latest='뭐 해?', now='2026-11-14T02:00:00+09:00', photos=[], preceding=[], attachment=null,conversationRules,lockResult={context:''}){
 const calls=[],prompts=[],models=[],warnings=[],images=[];
 const characterId=jiwoo?characterModes.STANDALONE_JIWOO_ID:'onyeu';
 const job={id:'pending',character_id:characterId,kind:'reply',lease:'lease',payload:{messages:[{role:'user',content:latest}],attachedPhotoId:attachment?'pending':undefined},context:{messages:[...preceding,{id:'pending',role:'user',content:latest,ts:Date.parse(now)}],memory:''},activity};
 const mocks={
  './project-reply':{projectReply:async text=>text},
  './jiwoo-conversation-rules':jiwooRules,
  './character-modes':characterModes,
  './jiwoo-preferences':jiwooPreferences,
  './incoming-call-intent':incomingCallIntent,
  './incoming-call':{incomingCallContext:async()=>''},
  './jiwoo-handoff':{jiwooHandoffContext:async()=>{assert.ok(jiwoo);return '넘겨온 대화 맥락';}},
  './jiwoo-lock':{jiwooLockTurn:async input=>typeof lockResult==='function'?lockResult(input):lockResult},
  './jiwoo-lock-data':lockData,
  './jiwoo-settings':{readJiwooPreferences:async()=>({...jiwooPreferences.defaultJiwooPreferences,chatPrompt:'문자 전용 예시',voicePrompt:'음성 전용 예시',conversationRules})},
  './project-context':{projectContext:async()=>{assert.ok(!jiwoo);return ''; }},
  './project-dialogue':projectDialogue,
  './memory':{serverRpc:async(_,body)=>{calls.push(body);return body.action==='claim'?job:body.action==='media'?attachment:{};},transcript:memoryExports.transcript,updateMemory:async()=>0},
  './characters':{readLiveCharacter:async()=>({id:characterId,name:jiwoo?'지우':'온유',prompt:'저장된 설정'})},
  './model-settings':{liveModelOverrides:async()=>({textModel:model})},
  './gemini-json':{geminiJson:async(prompt,_schema,_signal,image,options)=>{prompts.push(prompt);models.push(options?.model);images.push(image);if(_schema.properties.selection)return {selection:draft.albumSelection||''};return {kind:jiwoo?'photo':'reply',text:jiwoo?'*웃으며* 형, 나 쉬고 있었어 ㅋㅋ':'잠깐 쉬고 있었어.',scene:'',delaySeconds:8,awaySeconds:0,activity:'',...draft};}},
  './time-context':{currentTimeContext:()=>''},'./samples':{relatedSampleContext:async()=>''},
  './photo-intent':photoIntent,
  './jiwoo-album':jiwooAlbum,
  './call-photos':{readCallPhotos:async()=>photos},
  './reply-timing':{timingPrompt:'',timingPlan:()=>({delaySeconds:8,awaySeconds:0,activity:''}),urgentMessage:()=>false},
  './push':{deliverPushJobs:async()=>0},'./image-jobs':{runImageJob:async()=>{}},
 };
 const exports={};
 class FixedDate extends Date { constructor(...args){ super(...(args.length ? args : [now])); } }
 const source=fs.readFileSync(new URL('../lib/dokyeong/reply-jobs.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},console:{warn:(...args)=>warnings.push(args)},Date:FixedDate,setTimeout});
 const result=await exports.prepareReply('pending');return {result,calls,prompts,models,warnings,images};
}

test('idle characters with null or missing activity still generate and schedule replies',async()=>{
 for(const activity of [null,undefined,{}]){
  const outcome=await prepare(activity);
  assert.equal(outcome.prompts.length,1,'must reach generation instead of failing before it');
  assert.equal(outcome.calls.at(-1).action,'schedule');
  assert.equal(outcome.result.delaySeconds,8);assert.equal(outcome.warnings.length,0);
 }
});
test('existing activity is preserved in reply context',async()=>{
 const outcome=await prepare({reason:'샤워',until:'2026-10-06T01:00:00Z'});
 assert.match(outcome.prompts[0],/샤워; 완료 예정 2026-10-06T01:00:00Z/);
 assert.equal(outcome.calls.at(-1).action,'schedule');
});


test('queued text replies use the global text model',async()=>{
 const outcome=await prepare(null,'gemini-3.7-flash');
 assert.deepEqual(outcome.models,['gemini-3.7-flash']);
 assert.equal(outcome.calls.at(-1).action,'schedule');
});

test('Jiwoo queued replies recognize a direction about Jiwoo as a scene without user speech',async()=>{
 const text='지우가 탁자 위 조명을 켠다';
 const outcome=await prepare(null,null,true,{},'*'+text+'*');
 assert.ok(outcome.prompts[0].includes('[사용자 메시지 구분] '+JSON.stringify([{kind:'지문',text}])));
 assert.match(outcome.prompts[0],/해당 가상 장면에서 일어난 일로 받아들이고 그 직후부터 대화를 이어가/);
 assert.equal(outcome.calls.at(-1).action,'schedule');
});

test('Jiwoo queued text retains saved settings and chat reactions without creating photo jobs',async()=>{
 const outcome=await prepare(null,'gemini-3.5-flash-lite',true);
 assert.match(outcome.prompts[0],/저장된 설정/);
 assert.match(outcome.prompts[0],/\[문자 채팅\]/);
 assert.match(outcome.prompts[0],/최근 대화의 실제 시각/);
 assert.match(outcome.prompts[0],/문자 전용 예시/);
 assert.match(outcome.prompts[0],/넘겨온 대화 맥락/);
 assert.match(outcome.prompts[0],/16:00-21:00/);
 assert.doesNotMatch(outcome.prompts[0],/음성 전용 예시/);
 assert.deepEqual(outcome.models,['gemini-3.5-flash-lite']);
 const scheduled=outcome.calls.at(-1);
 assert.equal(scheduled.action,'schedule');
 assert.equal(scheduled.data.text,'형, 나 쉬고 있었어 ㅋㅋ');
 assert.equal(scheduled.data.photo,null);
 assert.equal(scheduled.data.delaySeconds,0);
});


test('Jiwoo schedule uses Korean weekdays and the saved work hours',()=>{
 const prefs=jiwooPreferences.defaultJiwooPreferences;
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-13T15:00:00Z'),prefs),/09:00 시작/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-14T05:00:00Z'),prefs),/21:00 종료 예정/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-14T12:00:00Z'),prefs),/종료 시각\(21:00\) 이후/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-13T05:00:00Z'),prefs),/정규 근무가 없는 날/);
});

test('a contextual Jiwoo call travels with the delivered reply, but a refusal prevents ringing',async()=>{
 const call=await prepare(null,null,true,{kind:'call',text:'목소리 듣고 싶네. 내가 지금 전화 걸게.'});
 assert.equal(call.calls.at(-1).data.callNow,true);
 assert.equal(call.calls.at(-1).data.delaySeconds,0);
 const implicit=await prepare(null,null,true,{kind:'reply',text:'형 기다려, 바로 전화할게.'});
 assert.equal(implicit.calls.at(-1).data.callNow,true);
 const blocked=await prepare(null,null,true,{kind:'call',text:'지금 전화 걸게.'},'지금은 전화 걸지 마');
 assert.equal(blocked.calls.at(-1).data.callNow,undefined);
 assert.doesNotMatch(blocked.calls.at(-1).data.text,/전화 걸게/);
 const future=await prepare(null,null,true,{kind:'call',text:'내일 전화할게.'});
 assert.equal(future.calls.at(-1).data.callNow,undefined);
});

test('Jiwoo replies by text during work and can start a call at the end of the shift',async()=>{
 const draft={kind:'call',text:'형 기다려, 바로 전화할게.'};
 const working=await prepare(null,null,true,draft,'뭐 해?','2026-11-14T09:00:00+09:00');
 assert.equal(working.calls.at(-1).data.callNow,undefined);
 assert.match(working.prompts[0],/지금은 먼저 전화할 수 없어/);
 const after=await prepare(null,null,true,draft,'뭐 해?','2026-11-14T21:00:00+09:00');
 assert.equal(after.calls.at(-1).data.callNow,true);
});

test('Jiwoo schedules a chat-enabled album photo through the ordinary reply without creating an image job',async()=>{
 const photos=[
  {id:'sleep-call',situation:'잠옷 셀카',tags:['침대','기상'],useFor:'call'},
  {id:'office-chat',situation:'시청 사무실 셀카',tags:['회사'],useFor:'both'},
  {id:'other-chat',situation:'저녁 러닝',tags:['러닝'],useFor:'chat'},
 ];
 const draft={kind:'album',scene:'1',text:'앨범에 있길래 골랐어.'};
 const outcome=await prepare(null,null,true,draft,'시청 사무실에서 찍은 셀카 보내줘',undefined,photos);
 assert.match(outcome.prompts[0],/시청 사무실 셀카/);
 assert.doesNotMatch(outcome.prompts[0],/잠옷 셀카/);
 assert.equal(outcome.calls.at(-1).data.albumPhotoId,'office-chat');
 assert.equal(outcome.calls.at(-1).data.photo,null);
 const organic=await prepare(null,null,true,draft,'오늘 시청 갔어?',undefined,photos);
 assert.equal(organic.calls.at(-1).data.albumPhotoId,'office-chat');
 assert.match(organic.prompts[0],/직접 요청하지 않아도/);
 for(const message of ['오늘 어때?', '회사 사진은 보내지 마']) {
  const ordinary=await prepare(null,null,true,draft,message,undefined,photos);
  assert.equal(ordinary.calls.at(-1).data.albumPhotoId,undefined);
 }
 const afterPhoto=[{role:'assistant',content:'아까 찍어둔 거야.',ts:Date.parse('2026-11-14T01:59:00+09:00'),albumPhotoId:'office-chat'}];
 const repeated=await prepare(null,null,true,draft,'지금도 사무실이야?',undefined,photos,afterPhoto);
 assert.equal(repeated.calls.at(-1).data.albumPhotoId,undefined);
});

test('Jiwoo sends the stored attachment to Gemini with the caption and does not generate for a photo question',async()=>{
 const question='이 사진에 뭐가 보여?';
 const outcome=await prepare(null,null,true,{kind:'reply',text:'창가에 화분이 보이네.'},question,undefined,[],[],{
  dataUrl:'data:image/jpeg;base64,YWJj',
 });
 assert.deepEqual(JSON.parse(JSON.stringify(outcome.images[0])),{mimeType:'image/jpeg',data:'YWJj'});
 assert.equal(outcome.calls.find(call=>call.action==='media').data.messageId,'pending');
 assert.match(outcome.prompts[0],new RegExp(question.replace('?','\\?')));
 assert.match(outcome.prompts[0],/첨부한 사진을 직접 봐/);
 assert.equal(outcome.calls.at(-1).data.photo,null);
});

test('unmatched photo requests can queue GPT generation with a contextual text fallback',async()=>{
 const request='서점에서 책 고르는 사진 보내줘';
 const reply='형은 서점 가면 어느 코너부터 봐?';
 const draft={kind:'photo',text:reply,scene:'서점에서 책을 고르는 지우'};
 const outcome=await prepare(null,null,true,draft,request);
 assert.match(outcome.prompts[0],/사진첩에 맞는 사진이 없으면 kind=photo/);
 assert.equal(outcome.calls.at(-1).data.albumPhotoId,undefined);
 assert.equal(outcome.calls.at(-1).data.photo.text,request);
 assert.equal(outcome.calls.at(-1).data.photo.scene,draft.scene);
 assert.equal(outcome.calls.at(-1).data.photo.fallbackText,reply);
 const declined=await prepare(null,null,true,draft,'사진은 보내지 마');
 assert.equal(declined.calls.at(-1).data.photo,null);
});

test('direct selfies, bare capture requests and accepted photo offers cannot end as a plain acknowledgement',async()=>{
 for(const request of ['셀카 좀 보내라','사진 찍으라니까','찍어','찍어봐','지금 네 모습 보고 싶어']){
  const outcome=await prepare(null,null,true,{kind:'reply',text:'형, 나 책 읽고 있어.',scene:'방에서 책을 읽는 지우의 셀카'},request);
  assert.ok(outcome.calls.at(-1).data.photo,request);
 }
 const preceding=[{role:'assistant',content:'사진 한 장 보내줄까?',ts:Date.parse('2026-11-14T01:59:00+09:00')}];
 const accepted=await prepare(null,null,true,{kind:'reply',text:'이렇게 쉬고 있어.',scene:'집에서 쉬는 셀카'},'응',undefined,[],preceding);
 assert.ok(accepted.calls.at(-1).data.photo);
});

test('before generating a requested photo, a skipped album selection is rechecked for a real match',async()=>{
 const photos=[{id:'reading',situation:'방에서 책 읽는 셀카',tags:['독서'],useFor:'both'}];
 const draft={kind:'photo',text:'나 책 읽는 중이야.',scene:'방에서 책 읽는 지우',albumSelection:'1'};
 const matched=await prepare(null,null,true,draft,'책 읽는 셀카 보내줘',undefined,photos);
 assert.equal(matched.prompts.length,2);assert.equal(matched.calls.at(-1).data.albumPhotoId,'reading');assert.equal(matched.calls.at(-1).data.photo,null);
 const missing=await prepare(null,null,true,{...draft,albumSelection:''},'책 읽는 셀카 보내줘',undefined,photos);
 assert.equal(missing.calls.at(-1).data.albumPhotoId,undefined);assert.ok(missing.calls.at(-1).data.photo);
});

test('a visual question permits a concrete photo scene without forcing images for ordinary greetings or refusals',async()=>{
 const visual=await prepare(null,null,true,{kind:'photo',text:'형, 책 읽고 있었어.',scene:'집 창가에서 책 읽는 셀카'},'뭐 하고 있어?');
 assert.ok(visual.calls.at(-1).data.photo);
 const plain=await prepare(null,null,true,{kind:'reply',text:'형, 책 읽고 있어.',scene:''},'뭐 해?');assert.equal(plain.calls.at(-1).data.photo,null);
 const refused=await prepare(null,null,true,{kind:'reply',text:'사진은 안 보낼래.',scene:''},'셀카 보내줘');assert.equal(refused.calls.at(-1).data.photo,null);
 const canceled=await prepare(null,null,true,{kind:'photo',text:'책 읽는 중.',scene:'독서'},'사진 보내지 마');assert.equal(canceled.calls.at(-1).data.photo,null);
});

test('stored current lock replies skip the model and all image generation',async()=>{
 const lock={context:'current record',reply:'이번 잠금 번호는 0012야.',sessionId:'session-current'};
 const outcome=await prepare(null,null,true,{},'키 비번 알려줘',undefined,[],[],null,undefined,lock);
 assert.equal(outcome.prompts.length,0);assert.equal(outcome.calls.at(-1).data.text,lock.reply);
 assert.equal(outcome.calls.at(-1).data.jiwooLockSession,lock.sessionId);assert.equal(outcome.calls.at(-1).data.photo,null);
});

test('Jiwoo can choose disclosure but the app supplies the exact stored digits',async()=>{
 const outcome=await prepare(null,null,true,{kind:'reply',text:'번호를 알려줄게.',scene:'',lockAction:'disclose'},'오늘은 여기까지 하자',undefined,[],[],null,undefined,
  input=>input.text==='이번 잠금 비밀번호 알려줘'?{context:'current record',reply:'이번 잠금 번호는 0012야.',sessionId:'current'}:{context:'active record'});
 assert.equal(outcome.prompts.length,1);assert.ok(outcome.calls.at(-1).data.text.includes('0012'));
 assert.equal(outcome.calls.at(-1).data.jiwooLockSession,'current');assert.equal(outcome.calls.at(-1).data.photo,null);
});

test('random album selection is bounded to valid, distinct scene choices and prefers unseen photos',()=>{
 const photos={scenes:[{id:'office-a'},{id:'office-b'},{id:'irrelevant'}],home:[]};
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'1, 2, 2, 9',[],()=>0),'office-a');
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'1, 2, 2, 9',[],()=>0.8),'office-b');
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'1, 2',['office-a'],()=>0),'office-b');
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'99',[],()=>0),undefined);
});

test('Jiwoo can share any of the ten home photos and prefers photos absent from recent chat',async()=>{
 const home=Array.from({length:10},(_,index)=>({
  id:`home-${index+1}`,situation:'집에서 찍은 셀카',tags:[jiwooAlbum.JIWOO_HOME_ALBUM_TAG],useFor:'both',
 }));
 const photos=[{id:'office',situation:'시청',tags:['회사'],useFor:'both'},...home];
 const candidates={scenes:[],home:jiwooAlbum.homeAlbumPhotos(photos,'chat')};
 for(let index=0;index<10;index++){
  assert.equal(jiwooAlbum.chooseAlbumPhoto(candidates,'home',[],()=>(index+0.5)/10),home[index].id);
 }
 assert.equal(jiwooAlbum.chooseAlbumPhoto(candidates,'home',home.slice(0,9).map(photo=>photo.id),()=>0),home[9].id);
 const draft={kind:'album',scene:'home',text:'형, 집에서 이러고 지내.'};
 const preceding=[{role:'assistant',content:'나 지금 집에서 쉬는데.',ts:Date.parse('2026-11-14T01:59:00+09:00')}];
 const outcome=await prepare(null,null,true,draft,'사진 한 장 보내줘',undefined,photos,preceding);
 assert.match(outcome.prompts[0],/지우가 지금 자기 집에 있는 게 분명하고/);
 assert.ok(home.some(photo=>photo.id===outcome.calls.at(-1).data.albumPhotoId));
 const declined=await prepare(null,null,true,draft,'사진은 보내지 마',undefined,photos,preceding);
 assert.equal(declined.calls.at(-1).data.albumPhotoId,undefined);
});

test('organic album matching recognizes conversational tags and requires a concrete subject',()=>{
 const photos=[
  {id:'books',situation:'창가에서 독서',tags:['독서','오후','집'],useFor:'both'},
  {id:'karaoke',situation:'웃으며 부르는 첫 소절',tags:['노래방','취미','외출'],useFor:'both'},
  {id:'river',situation:'강변 러닝',tags:['러닝','강변','저녁'],useFor:'both'},
  {id:'sofa',situation:'느긋한 오후',tags:['휴식','오후','집'],useFor:'both'},
  {id:'call-only',situation:'밤 산책로',tags:['러닝','밤'],useFor:'call'},
 ];
 const matches=(content,recentlySent=[])=>jiwooAlbum.matchingAlbumPhotos(photos,[{content}],'chat',{contextualOnly:true,recentlySent}).map(photo=>photo.id);
 assert.deepEqual(matches('책 뭐 봐?'),['books']);
 assert.deepEqual(matches('코노 가고 싶다'),['karaoke']);
 assert.deepEqual(matches('저녁에 어디 뛰고 왔어?'),['river']);
 assert.deepEqual(matches('저녁에 어디 뛰고 왔어?',['river']),[]);
 assert.deepEqual(matches('저녁에 집에 갈 거야'),[]);
});

test('proactive photo selection attaches through the existing texting workflow only when permitted',async()=>{
 const run=async(canText,choice,content)=>{
  const now='2026-11-14T02:00:00+09:00';
  const claim={lease:'lease',now,settings:{...jiwooPreferences.defaultJiwooPreferences,conversationRules:{common:'공통 선톡 수정',proactive:'선톡 반응 수정'}},canCall:true,canText,prompt:'지우',messages:[{role:'user',content,ts:Date.parse(now)}],calls:[]};
  const actions=[];
  const dependencies={
   './jiwoo-conversation-rules':jiwooRules,
  './character-modes':characterModes,'./jiwoo-album':jiwooAlbum,'./photo-intent':photoIntent,
   './gemini-json':{geminiJson:async prompt=>{assert.match(prompt,/공통 선톡 수정/);assert.match(prompt,/선톡 반응 수정/);return {action:choice,text:'형, 저녁에 생각나더라.',albumScenes:'1'};}},
   './incoming-call-intent':incomingCallIntent,'./jiwoo-preferences':jiwooPreferences,'./project-dialogue':projectDialogue,
   './call-photos':{readCallPhotos:async()=>[{id:'river',tags:['러닝'],useFor:'both',situation:'운동화 묶는 셀카'}]},
   './memory':{serverRpc:async(_,body)=>{actions.push(body);return body.action==='claim'?claim:null;}},
   './model-settings':{liveModelOverrides:async()=>({})},'./push':{deliverPushJobs:async()=>{}},
   './time-context':{currentTimeContext:()=>'',koreaTime:()=>now},
  };
  const exports={};
  const source=fs.readFileSync(new URL('../lib/dokyeong/jiwoo-proactive.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,require:name=>{assert.ok(dependencies[name],name);return dependencies[name];},AbortSignal,console});
  await exports.runJiwooProactive();
  return actions.at(-1).data;
 };
 assert.equal((await run(true,'text','저녁에 러닝한다며')).albumPhotoId,'river');
 assert.equal((await run(true,'text','저녁에 운동 사진 보내지 마')).albumPhotoId,undefined);
 assert.equal((await run(true,'call','저녁에 러닝한다며')).albumPhotoId,undefined);
 assert.equal((await run(false,'text','저녁에 러닝한다며')).albumPhotoId,undefined);
});

 test('queued Jiwoo text uses saved common and style rules without reappending defaults',async()=>{
 const outcome=await prepare(null,null,true,{kind:'reply'},'나 수업 들어가야 하는데',undefined,[],[],null,{common:'지금 같이 놀고 싶은 남친 반응',style:'말투 수정본',text:'문자 수정본'});
 for(const text of ['지금 같이 놀고 싶은 남친 반응','말투 수정본','문자 수정본'])assert.ok(outcome.prompts[0].includes(text));
 assert.doesNotMatch(outcome.prompts[0],/\[지우의 일상 말투\]/);
 });

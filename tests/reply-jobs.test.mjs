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

async function prepare(activity, model=null, jiwoo=false, draft={}, latest='뭐 해?', now='2026-11-14T02:00:00+09:00', photos=[], preceding=[]){
 const calls=[],prompts=[],models=[],warnings=[];
 const characterId=jiwoo?characterModes.STANDALONE_JIWOO_ID:'onyeu';
 const job={id:'pending',character_id:characterId,kind:'reply',lease:'lease',payload:{messages:[{role:'user',content:latest}]},context:{messages:[...preceding,{id:'pending',role:'user',content:latest,ts:Date.parse(now)}],memory:''},activity};
 const mocks={
  './project-reply':{projectReply:async text=>text},
  './character-modes':characterModes,
  './jiwoo-preferences':jiwooPreferences,
  './incoming-call-intent':incomingCallIntent,
  './incoming-call':{incomingCallContext:async()=>''},
  './jiwoo-settings':{readJiwooPreferences:async()=>({...jiwooPreferences.defaultJiwooPreferences,chatPrompt:'문자 전용 예시',voicePrompt:'음성 전용 예시'})},
  './project-context':{projectContext:async()=>{assert.ok(!jiwoo);return ''; }},
  './project-dialogue':projectDialogue,
  './memory':{serverRpc:async(_,body)=>{calls.push(body);return body.action==='claim'?job:{};},transcript:()=> '대화',updateMemory:async()=>0},
  './characters':{readLiveCharacter:async()=>({id:characterId,name:jiwoo?'지우':'온유',prompt:'저장된 설정'})},
  './model-settings':{liveModelOverrides:async()=>({textModel:model})},
  './gemini-json':{geminiJson:async(prompt,_schema,_signal,_image,options)=>{prompts.push(prompt);models.push(options?.model);return {kind:jiwoo?'photo':'reply',text:jiwoo?'*웃으며* 형, 나 쉬고 있었어 ㅋㅋ':'잠깐 쉬고 있었어.',scene:'',delaySeconds:8,awaySeconds:0,activity:'',...draft};}},
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
 const result=await exports.prepareReply('pending');return {result,calls,prompts,models,warnings};
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


test('Jiwoo queued text retains saved settings and chat reactions without creating photo jobs',async()=>{
 const outcome=await prepare(null,'gemini-3.5-flash-lite',true);
 assert.match(outcome.prompts[0],/저장된 설정/);
 assert.match(outcome.prompts[0],/\[문자 채팅\]/);
 assert.match(outcome.prompts[0],/최근 대화의 실제 시각/);
 assert.match(outcome.prompts[0],/문자 전용 예시/);
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

test('random album selection is bounded to valid, distinct scene choices and prefers unseen photos',()=>{
 const photos=[{id:'office-a'},{id:'office-b'},{id:'irrelevant'}];
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'1, 2, 2, 9',[],()=>0),'office-a');
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'1, 2, 2, 9',[],()=>0.8),'office-b');
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'1, 2',['office-a'],()=>0),'office-b');
 assert.equal(jiwooAlbum.chooseAlbumPhoto(photos,'99',[],()=>0),undefined);
});

test('proactive photo selection attaches through the existing texting workflow only when permitted',async()=>{
 const run=async(canText,choice,content)=>{
  const now='2026-11-14T02:00:00+09:00';
  const claim={lease:'lease',now,settings:jiwooPreferences.defaultJiwooPreferences,canCall:true,canText,prompt:'지우',messages:[{role:'user',content,ts:Date.parse(now)}],calls:[]};
  const actions=[];
  const dependencies={
   './character-modes':characterModes,'./jiwoo-album':jiwooAlbum,'./photo-intent':photoIntent,
   './gemini-json':{geminiJson:async()=>({action:choice,text:'형, 저녁에 생각나더라.',albumScenes:'1'})},
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

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

async function prepare(activity, model=null, jiwoo=false, draft={}, latest='뭐 해?', now='2026-11-14T02:00:00+09:00'){
 const calls=[],prompts=[],models=[],warnings=[];
 const characterId=jiwoo?characterModes.STANDALONE_JIWOO_ID:'onyeu';
 const job={id:'pending',character_id:characterId,kind:'reply',lease:'lease',payload:{messages:[{role:'user',content:latest}]},context:{messages:[{id:'pending',role:'user',content:latest,ts:1}],memory:''},activity};
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
 assert.match(outcome.prompts[0],/16:00-22:00/);
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
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-13T15:00:00Z'),prefs),/08:40 시작/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-14T05:00:00Z'),prefs),/22:00 종료 예정/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-14T13:00:00Z'),prefs),/종료 시각\(22:00\) 이후/);
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
 const working=await prepare(null,null,true,draft,'뭐 해?','2026-11-14T08:40:00+09:00');
 assert.equal(working.calls.at(-1).data.callNow,undefined);
 assert.match(working.prompts[0],/지금은 먼저 전화할 수 없어/);
 const after=await prepare(null,null,true,draft,'뭐 해?','2026-11-14T22:00:00+09:00');
 assert.equal(after.calls.at(-1).data.callNow,true);
});

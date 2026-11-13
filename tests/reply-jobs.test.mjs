import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as projectDialogue from '../lib/dokyeong/project-dialogue.ts';
import * as characterModes from '../lib/dokyeong/character-modes.ts';
import * as jiwooPreferences from '../lib/dokyeong/jiwoo-preferences.ts';
import * as photoIntent from '../lib/dokyeong/photo-intent.ts';

async function prepare(activity, model=null, jiwoo=false){
 const calls=[],prompts=[],models=[],warnings=[];
 const characterId=jiwoo?characterModes.STANDALONE_JIWOO_ID:'onyeu';
 const job={id:'pending',character_id:characterId,kind:'reply',lease:'lease',payload:{messages:[{role:'user',content:'뭐 해?'}]},context:{messages:[{id:'pending',role:'user',content:'뭐 해?',ts:1}],memory:''},activity};
 const mocks={
  './project-reply':{projectReply:async text=>text},
  './character-modes':characterModes,
  './jiwoo-preferences':jiwooPreferences,
  './jiwoo-settings':{readJiwooPreferences:async()=>({...jiwooPreferences.defaultJiwooPreferences,chatPrompt:'문자 전용 예시',voicePrompt:'음성 전용 예시'})},
  './project-context':{projectContext:async()=>{assert.ok(!jiwoo);return ''; }},
  './project-dialogue':projectDialogue,
  './memory':{serverRpc:async(_,body)=>{calls.push(body);return body.action==='claim'?job:{};},transcript:()=> '대화',updateMemory:async()=>0},
  './characters':{readLiveCharacter:async()=>({id:characterId,name:jiwoo?'지우':'온유',prompt:'저장된 설정'})},
  './model-settings':{liveModelOverrides:async()=>({textModel:model})},
  './gemini-json':{geminiJson:async(prompt,_schema,_signal,_image,options)=>{prompts.push(prompt);models.push(options?.model);return {kind:jiwoo?'photo':'reply',text:jiwoo?'*웃으며* 형, 나 쉬고 있었어 ㅋㅋ':'잠깐 쉬고 있었어.',scene:'',delaySeconds:8,awaySeconds:0,activity:''};}},
  './time-context':{currentTimeContext:()=>''},'./samples':{relatedSampleContext:async()=>''},
  './photo-intent':photoIntent,
  './reply-timing':{timingPrompt:'',timingPlan:()=>({delaySeconds:8,awaySeconds:0,activity:''}),urgentMessage:()=>false},
  './push':{deliverPushJobs:async()=>0},'./image-jobs':{runImageJob:async()=>{}},
 };
 const exports={};
 const source=fs.readFileSync(new URL('../lib/dokyeong/reply-jobs.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},console:{warn:(...args)=>warnings.push(args)},Date,setTimeout});
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
});


test('Jiwoo schedule uses Korean weekdays and the saved work hours',()=>{
 const prefs=jiwooPreferences.defaultJiwooPreferences;
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-13T15:00:00Z'),prefs),/09:00 시작/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-14T05:00:00Z'),prefs),/21:00 종료 예정/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-14T12:00:00Z'),prefs),/종료 시각\(21:00\) 이후/);
 assert.match(jiwooPreferences.jiwooScheduleContext(new Date('2026-11-13T05:00:00Z'),prefs),/정규 근무가 없는 날/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

async function prepare(activity){
 const calls=[],prompts=[],warnings=[];
 const job={id:'pending',character_id:'onyeu',kind:'reply',lease:'lease',payload:{messages:[{role:'user',content:'뭐 해?'}]},context:{messages:[{id:'pending',role:'user',content:'뭐 해?',ts:1}],memory:''},activity};
 const mocks={
  './memory':{serverRpc:async(_,body)=>{calls.push(body);return body.action==='claim'?job:{};},transcript:()=> '대화',updateMemory:async()=>0},
  './characters':{readLiveCharacter:async()=>({id:'onyeu',name:'온유',prompt:'설정'})},
  './gemini-json':{geminiJson:async(prompt)=>{prompts.push(prompt);return {kind:'reply',text:'잠깐 쉬고 있었어.',scene:'',delaySeconds:8,awaySeconds:0,activity:''};}},
  './time-context':{currentTimeContext:()=>''},'./samples':{relatedSampleContext:async()=>''},
  './photo-intent':{wantsPhoto:()=>false,declinesPhoto:()=>false},
  './reply-timing':{timingPrompt:'',timingPlan:()=>({delaySeconds:8,awaySeconds:0,activity:''}),urgentMessage:()=>false},
  './push':{deliverPushJobs:async()=>0},'./image-jobs':{runImageJob:async()=>{}},
 };
 const exports={};
 const source=fs.readFileSync(new URL('../lib/dokyeong/reply-jobs.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},console:{warn:(...args)=>warnings.push(args)},Date,setTimeout});
 const result=await exports.prepareReply('pending');return {result,calls,prompts,warnings};
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

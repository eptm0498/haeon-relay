import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import rules from './helpers/jiwoo-rules.mjs';
import * as prefs from '../lib/dokyeong/jiwoo-preferences.ts';
import * as modes from '../lib/dokyeong/character-modes.ts';
import {callMonologuePrompt} from '../lib/dokyeong/call-monologue.ts';
const path='app/api/dokyeong/character/[token]/jiwoo/route.ts';
const compile=path=>ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function editor({authorized=true,origin=true,conflict=false}={}) {
 let stored={...prefs.defaultJiwooPreferences,version:5}; const writes=[];
 const exports={};
 const mocks={
  '@/lib/dokyeong/auth':{noStore:{'Cache-Control':'no-store'},sameOrigin:()=>origin},
  '@/lib/dokyeong/jiwoo-conversation-rules':rules,
  '@/lib/dokyeong/jiwoo-preferences':prefs,
  '@/lib/dokyeong/character-modes':modes,
  '@/lib/dokyeong/memory':{serverRpc:()=>null},
  '@/lib/dokyeong/settings':{verifyEditor:async()=>authorized,rpc:async(_,body)=>{
   if(body.action==='save') { if(conflict) throw Error('VERSION_CONFLICT'); writes.push(body.settings);stored={...stored,...body.settings,version:stored.version+1}; }
   return stored;
  }},
 };
 vm.runInNewContext(compile(path),{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Response,Error});
 const context={params:Promise.resolve({token:'a'.repeat(64)})};
 const request=body=>{const request=new Request('https://app.test/edit',{method:'PUT',body:JSON.stringify(body)});request.nextUrl=new URL(request.url);return request;};
 return {read:()=>exports.GET({nextUrl:new URL('https://app.test/edit')},context),save:body=>exports.PUT(request(body),context),writes};
}
test('editor exposes actual defaults and edited behavior survives save and reload, including an intentionally empty field',async()=>{
 const app=editor();const initial=await (await app.read()).json();
 assert.deepEqual(Object.keys(initial.conversationRules).sort(),Array.from(rules.jiwooRuleDefinitions,r=>r.key).sort());
 assert.match(initial.conversationRules.common,/업무 수행을 명령/);
 assert.match(initial.conversationRules.common,/수행 가능한 부분에 지금 구체적으로 반응/);
 const conversationRules={...initial.conversationRules,common:'연인답게 함께 놀고 싶은 마음을 말해.',style:'',schedule:'일정은 참고만 해.'};
 assert.equal((await app.save({...initial,conversationRules})).status,200);
 const reload=await (await app.read()).json();
 assert.deepEqual(reload.conversationRules,conversationRules);
 assert.equal(rules.jiwooRule(reload,'style'),'');
 assert.match(prefs.jiwooScheduleContext(new Date(),reload),/일정은 참고만 해/);
 // Old clients must preserve new settings rather than erase them.
 const {conversationRules:unused,...legacy}=reload;
 await app.save(legacy);
 assert.deepEqual((await (await app.read()).json()).conversationRules,conversationRules);
 assert.equal('conversationRules' in app.writes[1],false);
});
test('behavior editing retains capability, origin, version and size validation',async()=>{
 const valid={...prefs.defaultJiwooPreferences,version:5};
 assert.equal((await editor({authorized:false}).read()).status,404);
 assert.equal((await editor({authorized:false}).save(valid)).status,404);
 assert.equal((await editor({origin:false}).save(valid)).status,403);
 assert.equal((await editor({conflict:true}).save(valid)).status,409);
 for(const conversationRules of [null,[],{unknown:'x'},{common:3},{common:'x'.repeat(8001)},Object.fromEntries(rules.jiwooRuleDefinitions.map(r=>[r.key,'x'.repeat(4000)]))]) {
  const app=editor();assert.equal((await app.save({...valid,conversationRules})).status,400);assert.equal(app.writes.length,0);
 }
});
test('edited monologue wording and directions retain actual turn and history substitutions',()=>{
 const prompt=callMonologuePrompt([{role:'assistant',content:'직전 대사'}],12,'새 지침 {{turn}} {{direction}} {{recent}}','첫 방향\n둘째 방향');
 assert.equal(prompt,'새 지침 13 첫 방향 ["직전 대사"]');
 assert.match(callMonologuePrompt([],13,'{{direction}}','첫 방향\n둘째 방향'),/둘째 방향/);
});
test('missed-call generation uses the same saved common and situation rules',async()=>{
 const prompts=[];let claimed=false;const exports={};
 const mocks={
  './jiwoo-conversation-rules':rules,'./character-modes':modes,
  './characters':{readLiveCharacter:async()=>({prompt:'지우의 기본 성격'})},
  './gemini-json':{geminiJson:async prompt=>{prompts.push(prompt);return {text:'형, 나랑 톡으로 놀자.'};}},
  './jiwoo-settings':{readJiwooPreferences:async()=>({...prefs.defaultJiwooPreferences,conversationRules:{common:'공통 반응 수정본',style:'말투 수정본',missedCall:'부재중 수정본'}})},
  './memory':{transcript:()=>'',serverRpc:async(_,body)=>body.action==='claim'?(claimed?null:(claimed=true,{id:'call',lease:'lease',epoch:'epoch',startedAt:new Date().toISOString(),now:new Date().toISOString(),messages:[],previousLines:[]})):true},
  './model-settings':{liveModelOverrides:async()=>({textModel:null})},
  './project-dialogue':{dialogueOnly:text=>text},'./push':{deliverPushJobs:async()=>0},'./time-context':{koreaTime:date=>date.toISOString()},
 };
 vm.runInNewContext(compile('lib/dokyeong/missed-call-followup.ts'),{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},AbortSignal,Date,console});
 assert.equal(await exports.sendMissedCallFollowups(),1);
 for(const word of ['공통 반응 수정본','말투 수정본','부재중 수정본']) assert.ok(prompts[0].includes(word));
});

 test('the settings screen renders every current rule as a full editable field',()=>{
 const settings={...prefs.defaultJiwooPreferences,conversationRules:rules.resolvedJiwooRules(null)};
 settings.conversationRules.common+='\n마지막 글자까지 편집 가능';
 const states=[settings,null,false,'',0];const exports={};
 const mocks={
  'react':{...React,useState:()=>[states.shift(),()=>{}],useEffect:()=>{}},'react/jsx-runtime':jsx,
  '@/lib/dokyeong/jiwoo-conversation-rules':rules,'@/lib/dokyeong/jiwoo-preferences':prefs,
  '../../JiwooProactiveFields':{default:()=>null},'./editor.module.css':{default:{}},
 };
 vm.runInNewContext(compile('app/dokyeong-live/edit/[token]/JiwooSettings.tsx'),{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];}});
 const html=renderToStaticMarkup(React.createElement(exports.default,{endpoint:'/editor/jiwoo',memory:false}));
 for(const rule of rules.jiwooRuleDefinitions) {
  assert.ok(html.includes(`id="jiwoo-rule-${rule.key}"`));
  assert.match(html,new RegExp(`<textarea[^>]*id="jiwoo-rule-${rule.key}"[^>]*maxLength="8000"`));
 }
 assert.ok(html.includes('마지막 글자까지 편집 가능'));
 assert.match(html,/<textarea[^>]*id="jiwoo-fixed-boundary"[^>]*readOnly=""/);
 });

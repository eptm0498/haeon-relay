import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
const {dialogueOnly,spokenDialogue,projectMediumPrompt,isProjectCharacter}=dialogue;
function harness(previous={}){
 const calls=[],prompts=[],exports={};
 const mocks={'node:crypto':{createHash},'./settings':{rpc:async(name,body)=>{calls.push({name,...body});if(body.action==='read')return previous;return {...previous,...body.data};}},'./gemini-json':{geminiJson:async(prompt)=>{prompts.push(prompt);return {summary:'검증된 관계와 최신 사건'};}},'./project-dialogue':dialogue};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/dokyeong/project-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,require:name=>{assert.ok(mocks[name],name);return mocks[name];},process:{env:{CHARACTER_HISTORY_KEY:'test-only'}}});
 return {module:exports,calls,prompts};
}
const message=(id,content=id,role='user')=>({id,role,content});
const sourceUrl='https://chatgpt.com/g/g-p-00000000000000000000000000000000/c/00000000-0000-0000-0000-000000000001';
test('Jiwoo chat keeps chat reactions, voice has only pronounceable dialogue',()=>{
 const text='지우가 웃는다.\n지우: "ㅇㅇ 기분 좋아짐 ㅋㅋㅋ"\n태성: "내 대사는 읽지 마."';
 assert.equal(dialogueOnly(text),'ㅇㅇ 기분 좋아짐 ㅋㅋㅋ');
 assert.equal(spokenDialogue(text),'응 기분 좋아졌어');
 assert.equal(spokenDialogue('*고개를 끄덕이며* 알겠음 ㅋㅋ ❤️'),'알겠어');
 assert.equal(dialogueOnly('아까 "좋아"라고 했잖아.'),'아까 "좋아"라고 했잖아.');
 assert.equal(dialogueOnly('네가 좋아서 하는 말이다.'),'네가 좋아서 하는 말이다.');
 assert.match(projectMediumPrompt(),/지금은 카톡/);assert.match(projectMediumPrompt(true),/지금은 음성 통화/);
 assert.equal(isProjectCharacter({prompt:'도경'}),false);
});
test('source snapshots preserve history order, replace edits and do not duplicate',()=>{
 const {module:m}=harness();
 const old=[message('b'),message('c')],incoming=[message('a'),message('b','정정'),message('c'),message('d')];
 const merged=m.mergeProjectMessages(old,incoming);
 assert.equal(JSON.stringify(merged.map(x=>x.id)),JSON.stringify(['a','b','c','d']));
 assert.equal(merged[1].content,'정정');
 assert.equal(JSON.stringify(m.mergeProjectMessages(merged,incoming)),JSON.stringify(merged));
 assert.equal(JSON.stringify(m.mergeProjectMessages(merged,[message('a')],true)),JSON.stringify([message('a')]));
});
test('snapshot validation rejects instructions disguised as roles, duplicate IDs and malformed content',()=>{
 const {module:m}=harness();
 for(const value of [[],[message('a','x','system')],[message('a'),message('a')],[message('a','')],[message('a','x'.repeat(30001))]])assert.throws(()=>m.normalizeProjectMessages(value));
 assert.equal(m.normalizeProjectMessages([message('safe')]).length,1);
});
test('no change only updates checked time and performs no summary write',async()=>{
 const m=harness().module;const messages=[message('a')];
 const {module:api,calls}=harness({source_url:sourceUrl,version:2,messages,content_hash:m.snapshotHash(messages),partial:true});
 await api.saveProjectSnapshot('jiwoo',{version:2,sourceUrl:sourceUrl,messages,partial:true});
 assert.deepEqual(calls.map(c=>c.action),['read','check']);
});
test('JSONB object key ordering cannot trigger duplicate summary generation',()=>{
 const {module:m}=harness();
 assert.equal(m.snapshotHash([{id:'a',role:'user',content:'안녕'}]),m.snapshotHash([{content:'안녕',role:'user',id:'a'}]));
});
test('different source and stale revision cannot change saved state',async()=>{
 const {module:api,calls}=harness({source_url:sourceUrl,version:2,messages:[]});
 await assert.rejects(api.saveProjectSnapshot('jiwoo',{version:2,sourceUrl:'https://other.test/',messages:[message('a')]}));
 await assert.rejects(api.saveProjectSnapshot('jiwoo',{version:1,sourceUrl:sourceUrl,messages:[message('a')]}),/VERSION_CONFLICT/);
 assert.ok(calls.every(c=>c.action==='read'));
});
test('updated project snapshot writes only its source context, never app history',async()=>{
 const {module:api,calls}=harness({source_url:sourceUrl,version:2,messages:[message('b')],summary:'기존 관계',content_hash:'',partial:true});
 await api.saveProjectSnapshot('jiwoo',{version:2,sourceUrl:sourceUrl,messages:[message('a'),message('b'),message('c')],partial:false});
 assert.equal(calls.at(-1).action,'save');assert.equal(calls.at(-1).data.partial,false);
 assert.ok(calls.every(c=>c.name==='live_project_context'));
});
test('non-linked characters have no source lookup or fictional project context',async()=>{
 const {module:api,calls}=harness();assert.equal(await api.projectContext({id:'dokyeong',prompt:'도경 설정'}),'');assert.equal(calls.length,0);
});

const source=(id,order,messages=[],summary='')=>({id,title:id,url:sourceUrl.slice(0,-1)+order,order,messages,summary,content_hash:'',partial:true,updated_at:null,checked_at:null});
test('a complete 02 import replaces only 02 and never merges duplicate IDs across threads',async()=>{
 const sources=[source('01',1,[message('same','고교 시절')],'고교 과거'),source('02',2,[message('old')],'이전02'),source('03',3,[message('same','대학생 현재')],'최신03')];
 const {module:api,calls,prompts}=harness({sources,version:4});
 await api.saveProjectSnapshot('jiwoo',{version:4,sourceId:'02',sourceUrl:sources[1].url,messages:[message('same','수정된02')],partial:false});
 assert.deepEqual(calls.map(c=>c.action),['read','save_source']);
 assert.equal(calls.at(-1).data.source_id,'02');assert.equal(calls.at(-1).data.messages.length,1);
 assert.equal(sources[0].messages[0].content,'고교 시절');assert.equal(sources[2].messages[0].content,'대학생 현재');
 assert.ok(!prompts[0].includes('최신03'));assert.ok(!prompts[0].includes('이전02'));
});
test('old-thread imports cannot change the configured latest-thread precedence',async()=>{
 const sources=[source('03',3,[message('new','새 캠퍼스')],'대학생 현재'),source('01',1,[message('old','옛 교실')],'고교 과거'),source('02',2,[],'중간 사건')];
 const {module:api}=harness({sources,updated_at:'2099-01-01'});
 const prompt=await api.projectContext({id:'jiwoo',prompt:dialogue.PROJECT_CHARACTER_MARKER});
 assert.match(prompt,/01 → 02 → 03/);assert.match(prompt,/최신 방 03/);assert.match(prompt,/새 캠퍼스/);assert.doesNotMatch(prompt,/옛 교실/);
});
test('source IDs and URLs must match, including canonical project-slug redirects',async()=>{
 const {module:api,calls}=harness({sources:[source('01',1),source('02',2)],version:4});
 await assert.rejects(api.saveProjectSnapshot('jiwoo',{version:4,sourceId:'01',sourceUrl:sourceUrl.slice(0,-1)+'2',messages:[message('a')]}));
 assert.ok(calls.every(c=>c.action==='read'));
 assert.equal(api.canonicalProjectChatUrl(sourceUrl.replace('/c/','-hanji/c/')),sourceUrl);
 for(const url of [sourceUrl+'?x=1',sourceUrl.replace('chatgpt.com','chatgpt.com.evil.test'),sourceUrl.replace('/g/g-p-','/share/g-p-')])assert.throws(()=>api.canonicalProjectChatUrl(url));
});
test('an unchanged 03 source is checked without summary generation or writes',async()=>{
 const messages=[message('a')],s=source('03',3,messages,'현재');const m=harness().module;s.content_hash=m.snapshotHash(messages);
 const {module:api,calls,prompts}=harness({sources:[s],version:4});
 await api.saveProjectSnapshot('jiwoo',{version:4,sourceId:'03',sourceUrl:s.url,messages,partial:true});
 assert.deepEqual(calls.map(c=>c.action),['read','check']);assert.equal(calls.at(-1).data.source_id,'03');assert.equal(prompts.length,0);
});
test('long complete threads are summarised in order in bounded batches before one write',async()=>{
 const s=source('02',2),{module:api,calls,prompts}=harness({sources:[s],version:4});
 await api.saveProjectSnapshot('jiwoo',{version:4,sourceId:'02',sourceUrl:s.url,messages:[message('a','가'.repeat(30000)),message('b','나'.repeat(30000))],partial:false});
 assert.equal(prompts.length,2);assert.match(prompts[1],/검증된 관계와 최신 사건/);assert.deepEqual(calls.map(c=>c.action),['read','save_source']);
});
test('the browser capture ignores a cached hidden conversation',async()=>{
 const node=(id,content)=>({getAttribute:name=>name==='data-chatgpt-search-unit-key'?'turn:user':name==='data-chatgpt-search-message-ids'?id:null,cloneNode:()=>({textContent:content,querySelectorAll:()=>[]})});
 const root=(visible,id,content)=>({isConnected:true,getBoundingClientRect:()=>({width:visible?100:0,height:visible?100:0}),querySelector:()=>true,querySelectorAll:selector=>selector==='[data-chatgpt-search-unit-key]'?[node(id,content)]:[],scrollTop:0,dispatchEvent:()=>{},innerText:''});
 const hidden=root(false,'wrong','다른 채팅'),visible=root(true,'right','선택한 채팅');
 const code=fs.readFileSync(new URL('../extensions/jiwoo-project-bridge/capture.js',import.meta.url),'utf8');
 const result=await vm.runInNewContext(code,{location:{href:sourceUrl,pathname:new URL(sourceUrl).pathname},document:{querySelectorAll:()=>[hidden,visible]},Date,Event,setTimeout:fn=>fn()});
 assert.equal(result.messages.length,1);assert.equal(result.messages[0].id,'right');assert.equal(result.partial,false);
});

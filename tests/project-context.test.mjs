import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
const {dialogueOnly,spokenDialogue,projectMediumPrompt,isProjectCharacter}=dialogue;
function harness(previous={}){
 const calls=[],exports={};
 const mocks={'node:crypto':{createHash},'./settings':{rpc:async(name,body)=>{calls.push({name,...body});if(body.action==='read')return previous;return {...previous,...body.data};}},'./gemini-json':{geminiJson:async()=>({summary:'검증된 관계와 최신 사건'})},'./project-dialogue':dialogue};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/dokyeong/project-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},process:{env:{CHARACTER_HISTORY_KEY:'test-only'}}});
 return {module:exports,calls};
}
const message=(id,content=id,role='user')=>({id,role,content});
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
 const {module:api,calls}=harness({source_url:'https://chatgpt.com/source',version:2,messages,content_hash:m.snapshotHash(messages),partial:true});
 await api.saveProjectSnapshot('jiwoo',{version:2,sourceUrl:'https://chatgpt.com/source',messages,partial:true});
 assert.deepEqual(calls.map(c=>c.action),['read','check']);
});
test('different source and stale revision cannot change saved state',async()=>{
 const {module:api,calls}=harness({source_url:'https://chatgpt.com/source',version:2,messages:[]});
 await assert.rejects(api.saveProjectSnapshot('jiwoo',{version:2,sourceUrl:'https://other.test/',messages:[message('a')]}));
 await assert.rejects(api.saveProjectSnapshot('jiwoo',{version:1,sourceUrl:'https://chatgpt.com/source',messages:[message('a')]}),/VERSION_CONFLICT/);
 assert.ok(calls.every(c=>c.action==='read'));
});
test('updated project snapshot writes only its source context, never app history',async()=>{
 const {module:api,calls}=harness({source_url:'https://chatgpt.com/source',version:2,messages:[message('b')],summary:'기존 관계',content_hash:'',partial:true});
 await api.saveProjectSnapshot('jiwoo',{version:2,sourceUrl:'https://chatgpt.com/source',messages:[message('a'),message('b'),message('c')],partial:false});
 assert.equal(calls.at(-1).action,'save');assert.equal(calls.at(-1).data.partial,false);
 assert.ok(calls.every(c=>c.name==='live_project_context'));
});
test('non-linked characters have no source lookup or fictional project context',async()=>{
 const {module:api,calls}=harness();assert.equal(await api.projectContext({id:'dokyeong',prompt:'도경 설정'}),'');assert.equal(calls.length,0);
});

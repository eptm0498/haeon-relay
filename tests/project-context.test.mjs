import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
function load(file,mocks){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/dokyeong/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},process:{env:{CHARACTER_HISTORY_KEY:'fixture-only'}}});return exports;
}
const archive={source_title:'01',source_url:'private-fixture',captured_at:'2026-10-19',complete:true,message_count:120,instructions:'서로 성인일 때 대학에서 처음 만났다.',current_state:'현재는 전역 후 재회해 함께 지낸다.',style_guide:'편하고 다정한 직접 대사.',chapters:Array.from({length:12},(_,i)=>({id:String(i+1),title:i===0?'첫날 우산 약속':'과거 사건 '+i,facts:i===0?'노란 우산은 다음날 돌려주기로 했다.':'확인된 사건 '+i,terms:i===0?['우산','첫날']:[],sourceIds:['fixture-'+i]})),examples:[{cue:'보고 싶다',reply:'나도ㅋㅋ',spoken:'나도.',sourceId:'fixture-style'}]};
test('only Jiwoo can read the private fixed archive; there is no update action',async()=>{
 const calls=[];const api=load('project-context.ts',{'./settings':{rpc:async(name,body)=>{calls.push({name,...body});return archive;}},'./project-dialogue':dialogue});
 assert.equal(await api.projectContext({id:'other',prompt:'도경'}),'');assert.equal(calls.length,0);
 const context=await api.projectContext({id:'jiwoo',prompt:dialogue.PROJECT_CHARACTER_MARKER},[{role:'user',content:'첫날 우산 돌려줬나?'}],true);
 assert.match(context,/노란 우산/);assert.match(context,/전역 후/);assert.match(context,/대학에서 처음/);assert.match(context,/지우: 나도\./);assert.doesNotMatch(context,/나도ㅋㅋ/);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'live_story_memory');assert.ok(!('action' in calls[0])&&!('data' in calls[0]));
});
test('missing or incomplete source cannot silently fall back to the wrong story',async()=>{
 for(const data of [null,{...archive,complete:false}]){
  const api=load('project-context.ts',{'./settings':{rpc:async()=>data},'./project-dialogue':dialogue});
  await assert.rejects(api.projectContext({id:'jiwoo',prompt:dialogue.PROJECT_CHARACTER_MARKER}),/not ready/);
 }
});
test('voice normalizes chat reactions without reading another speaker or stage directions',()=>{
 const text='지우가 웃는다.\n지우: "ㅇㅇ 기분 좋아짐 ㅋㅋㅋ"\n태성: "내 대사는 읽지 마."';
 assert.equal(dialogue.dialogueOnly(text),'ㅇㅇ 기분 좋아짐 ㅋㅋㅋ');assert.equal(dialogue.spokenDialogue(text),'응 기분 좋아졌어');
 assert.equal(dialogue.spokenDialogue('*고개를 끄덕이며* 알겠음 ㅋㅋ ❤️'),'알겠어');
 assert.equal(dialogue.dialogueOnly('아까 "좋아"라고 했잖아.'),'아까 "좋아"라고 했잖아.');
 assert.equal(dialogue.dialogueOnly('네가 좋아서 하는 말이다.'),'네가 좋아서 하는 말이다.');
 assert.equal(dialogue.dialogueOnly('지우는 웃으며 “보고 싶었어.”라고 말했다. 도혁은 “나도.”라고 답했다.'),'');
});
test('narrative generation is repaired once before output or speech; valid dialogue costs no extra call',async()=>{
 let calls=0;const api=load('project-reply.ts',{'./project-dialogue':dialogue,'./gemini-json':{geminiJson:async()=>{calls++;return {dialogue:'나도 보고 싶었어. ㅋㅋ'};}}});
 assert.equal(await api.projectReply('나도 보고 싶었어.',true),'나도 보고 싶었어.');assert.equal(calls,0);
 assert.equal(await api.projectReply('지우는 웃으며 “보고 싶었어.”라고 말했다. 도혁은 “나도.”라고 답했다.',true),'나도 보고 싶었어.');assert.equal(calls,1);
});
test('a failed repair cannot read narration or invent a fallback reply',async()=>{
 const api=load('project-reply.ts',{'./project-dialogue':dialogue,'./gemini-json':{geminiJson:async()=>({dialogue:'지우는 고개를 끄덕였다.'})}});
 await assert.rejects(api.projectReply('지우는 웃었다.'),/Invalid character dialogue/);
});

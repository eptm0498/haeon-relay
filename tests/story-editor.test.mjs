import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseStorySettings} from '../lib/dokyeong/story-settings.ts';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
import * as references from '../lib/dokyeong/reference-images.ts';
import {retryAllowed} from '../lib/dokyeong/rpc-transport.ts';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as icons from 'lucide-react';

const memory={instructions:'성격 전문\n마지막 문장',current_state:'최신 상황',style_guide:'지우의 말투',chat_prompt:'편집한 채팅 지침',voice_prompt:'편집한 음성 지침',chapters:[{id:'first',title:'첫 사건',facts:'사건 전문',terms:['사건'],sourceIds:['original-1']}],examples:[{cue:'반가울 때',reply:'나도ㅋㅋ',spoken:'나도.',sourceId:'original-2'}],memory_excerpts:[{seq:1,sourceId:'original-1',text:'과거 기억 발췌 전문'}]};
const character={id:'c30b2085-d28a-4272-a9fb-c7ebcb8e7d90',name:'지우',prompt:'기본 지침'.repeat(30),version:7,voice_id:'fixture-voice',voice_name:'승',is_default:false,sort_order:2,reference_images:references.emptyReferences()};
const load=(file,mocks)=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Response,TextEncoder,Error,process:{env:{CHARACTER_HISTORY_KEY:'test-only'}}});return exports;
};
test('full editable memory survives round-trip while immutable originals cannot be written',()=>{
 const input={...memory,instructions:'첫 줄\n'+('긴 전체 기억 한글\n'.repeat(3000))+'마지막 줄',source_messages:[{content:'changed'}],source_hash:'changed',source_instructions:'changed',message_count:0};
 const parsed=parseStorySettings(JSON.parse(JSON.stringify(input)));
 assert.ok(parsed);assert.equal(parsed.instructions,input.instructions);assert.deepEqual(parsed.memory_excerpts,memory.memory_excerpts);
 assert.deepEqual(Object.keys(parsed).sort(),Object.keys(memory).sort());
});
test('invalid structures and oversized entries fail before any write; clearing editable fields is intentional',()=>{
 for(const patch of [{chapters:null},{chapters:[{...memory.chapters[0],facts:4}]},{examples:[null]},{memory_excerpts:[{seq:-1,text:'x',sourceId:''}]},{voice_prompt:'x'.repeat(60001)},{chapters:[memory.chapters[0],memory.chapters[0]]}]) assert.equal(parseStorySettings({...memory,...patch}),null);
 assert.equal(parseStorySettings({...memory,chat_prompt:'',voice_prompt:'',chapters:[],examples:[],memory_excerpts:[]}).voice_prompt,'');
});
test('editor renders full memory fields, chapter facts, dialogue variants and excerpts without truncation',()=>{
 const component=load('app/dokyeong-live/edit/[token]/StoryEditor.tsx',{
  react:React,'react/jsx-runtime':jsx,'lucide-react':icons,'./editor.module.css':{__esModule:true,default:{}},
 }).default;
 const value={...memory,intimacy_prompt:'',instructions:'첫 줄\n'+('긴 기억\n'.repeat(1500))+'마지막 줄',source_title:'01',message_count:955};
 const html=renderToStaticMarkup(React.createElement(component,{value,onChange:()=>{},api:'/fixture',characterId:character.id,disabled:false}));
 assert.ok(html.includes(value.instructions));
 for(const text of ['사건 전문','나도ㅋㅋ','나도.','과거 기억 발췌 전문','편집한 채팅 지침','편집한 음성 지침','원문 955개 메시지','처음 가져온 프로젝트 지침']) assert.ok(html.includes(text),text);
 assert.ok(!html.includes('maxlength="30000"'));
 assert.ok(html.includes('성적인 상황의 대사·반응 (직접 입력)'));
 assert.match(html,/<textarea[^>]*id="story-intimacy_prompt"[^>]*><\/textarea>/);
});
test('custom reactions can be saved verbatim, cleared, or omitted by legacy editors',()=>{
 const text='반가우면 짧게 응답한다.\n사용자가 직접 적은 반응';
 assert.equal(parseStorySettings({...memory,intimacy_prompt:text}).intimacy_prompt,text);
 assert.equal(parseStorySettings({...memory,intimacy_prompt:''}).intimacy_prompt,'');
 assert.ok(!Object.hasOwn(parseStorySettings(memory),'intimacy_prompt'),'omission preserves the saved field in the database');
 for(const value of [null,123,{},'a'.repeat(60001)]) assert.equal(parseStorySettings({...memory,intimacy_prompt:value}),null);
});
test('profile and story use one versioned write; other characters retain the original save path',async()=>{
 const calls=[];const api=load('lib/dokyeong/characters.ts',{'./settings':{rpc:async(name,body)=>{calls.push({name,body});return character;}},'./reference-images':references});
 await api.saveLiveCharacter('fixture-editor',character,memory);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'live_save_character_with_story');assert.equal(calls[0].body.character_data.version,7);assert.equal(calls[0].body.story.instructions,memory.instructions);
 await api.saveLiveCharacter('fixture-editor',character);
 assert.equal(calls[1].name,'live_save_character_with_references');
 assert.equal(retryAllowed('live_save_character_with_story',{}),false);
 assert.equal(retryAllowed('live_editor_story',{}),true);
});
test('runtime selects edited chat or voice instructions without appending hidden default instructions',async()=>{
 const api=load('lib/dokyeong/project-context.ts',{'./settings':{rpc:async()=>({...memory,source_title:'01',captured_at:'fixture',message_count:955,complete:true})},'./project-dialogue':dialogue});
 const chat=await api.projectContext(character,[],false),voice=await api.projectContext(character,[],true);
 assert.match(chat,/편집한 채팅 지침$/);assert.doesNotMatch(chat,/편집한 음성 지침|이 앱에서의 지우 —/);
 assert.match(voice,/편집한 음성 지침$/);assert.doesNotMatch(voice,/편집한 채팅 지침|이 앱에서의 지우 —/);
 assert.match(chat,/마지막 문장/);assert.match(chat,/설정실에서 편집한/);
 assert.ok(dialogue.isProjectCharacter(character),'editing the marker must not disconnect existing Jiwoo memory');
 const empty=load('lib/dokyeong/project-context.ts',{'./settings':{rpc:async()=>({...memory,chat_prompt:'',complete:true,source_title:'01'})},'./project-dialogue':dialogue});
 assert.doesNotMatch(await empty.projectContext(character),/이 앱에서의 지우 —/);
});
test('custom reactions reach chat and voice exactly once; an empty field adds no default reaction',async()=>{
 let custom='직접 입력한 테스트 반응';
 const api=load('lib/dokyeong/project-context.ts',{'./settings':{rpc:async()=>({...memory,intimacy_prompt:custom,complete:true,source_title:'01'})},'./project-dialogue':dialogue});
 for(const voice of [false,true]){
  const text=await api.projectContext(character,[],voice);
  assert.equal(text.split(custom).length-1,1);assert.match(text,/직접 입력한 상황별 대사·반응/);
 }
 for(custom of ['', '  \n']) assert.doesNotMatch(await api.projectContext(character),/직접 입력한 상황별 대사·반응/);
 assert.ok(dialogue.projectMediumPrompt().length<200);assert.ok(dialogue.projectMediumPrompt(true).length<200);
 assert.doesNotMatch(dialogue.projectMediumPrompt(),/세계관|다정함|연인 사이/);
});
test('editor reads require a valid capability and return complete data with explicit legacy defaults',async()=>{
 let allowed=false,calls=0;
 const api=load('app/api/dokyeong/character/[token]/story/route.ts',{
  'next/server':{},'@/lib/dokyeong/auth':{noStore:{'Cache-Control':'no-store'}},
  '@/lib/dokyeong/settings':{verifyEditor:async()=>allowed,rpc:async()=>{calls++;return {...memory,chat_prompt:null,voice_prompt:null};}},
  '@/lib/dokyeong/project-dialogue':dialogue,
 });
 const request={nextUrl:new URL('https://fixture.invalid?characterId='+character.id)},context={params:Promise.resolve({token:'fixture'})};
 assert.equal((await api.GET(request,context)).status,404);assert.equal(calls,0);
 allowed=true;const response=await api.GET(request,context),data=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(data.instructions,memory.instructions);assert.equal(data.chat_prompt,dialogue.projectMediumPrompt());assert.equal(data.voice_prompt,dialogue.projectMediumPrompt(true));
 assert.equal(data.intimacy_prompt,'');
});
test('save endpoint validates memory, rejects cross-origin changes and preserves conflicts',async()=>{
 let origin=true,calls=0,conflict=false,expectedStory=memory;
 const api=load('app/api/dokyeong/character/[token]/characters/route.ts',{
  'next/server':{},'@/lib/dokyeong/auth':{sameOrigin:()=>origin,noStore:{}},
  '@/lib/dokyeong/settings':{verifyEditor:async()=>true},'@/lib/dokyeong/reference-images':references,'@/lib/dokyeong/story-settings':{parseStorySettings},
  '@/lib/dokyeong/characters':{saveLiveCharacter:async(token,profile,story)=>{calls++;assert.deepEqual(JSON.parse(JSON.stringify(story)),expectedStory);if(conflict)throw Error('VERSION_CONFLICT');return {...profile,version:8,story};}},
 });
 const context={params:Promise.resolve({token:'fixture'})},req=body=>({text:async()=>JSON.stringify({...character,...body})});
 origin=false;assert.equal((await api.POST(req({story:memory}),context)).status,403);assert.equal(calls,0);
 origin=true;assert.equal((await api.POST(req({story:{...memory,chapters:null}}),context)).status,400);assert.equal(calls,0);
 const saved=await api.POST(req({story:memory}),context);assert.equal(saved.status,200);assert.equal((await saved.json()).story.current_state,memory.current_state);assert.equal(calls,1);
 for(const text of ['직접 작성한 테스트 응답\n두 번째 줄','']){
  expectedStory={...memory,intimacy_prompt:text};
  const response=await api.POST(req({story:expectedStory}),context);
  assert.equal(response.status,200);assert.equal((await response.json()).story.intimacy_prompt,text);
 }
 conflict=true;assert.equal((await api.POST(req({story:expectedStory}),context)).status,409);assert.equal(calls,4);
});

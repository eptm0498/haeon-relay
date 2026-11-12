import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
import * as characterModes from '../lib/dokyeong/character-modes.ts';
import * as callScenes from '../lib/dokyeong/call-scenes.ts';
import {voiceFailure} from '../lib/dokyeong/voice-failure.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({linked=false,photos,voiceOnly=false,realtime=true}={}){
 const gates=Object.fromEntries(['activity','samples','memory','project','headers'].map(k=>[k,deferred()]));
 const started=[],sockets=[],timers=[],repairs=[];let input,clock=0,fetchCalled=false,modelBody;
 const upstream=new ReadableStream({start(controller){input=controller;}});
 class Socket extends EventTarget{
  readyState=0;sent=[];
  constructor(url){super();this.url=url;sockets.push(this);}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  message(value){const event=new Event('message');event.data=JSON.stringify(value);this.dispatchEvent(event);}
  send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.flush)this.message({audio:'AAABAA==',is_final_audio_for_turn:true});if(value.close_socket)this.message({audio:'AAABAA==',is_final:true});}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 }
 const read=name=>{started.push(name);return gates[name].promise;};
 const mocks={
  'next/server':{after:()=>assert.fail('no background mutations for a diagnostic turn')},
  '@/lib/dokyeong/auth':{authenticated:()=>true,sameOrigin:()=>true,noStore:{'Cache-Control':'no-store'}},
  '@/lib/dokyeong/config':{liveConfig:{gemini:{responseModel:'fixture-model'},elevenlabs:{dialogueRealtimeModelId:'eleven_v3_conversational',dialogueOutputFormat:'pcm_24000'}}},
  '@/lib/dokyeong/character-modes':characterModes,
  '@/lib/dokyeong/call-scenes':callScenes,
  '@/lib/dokyeong/call-photos':{readCallPhotos:async()=>{assert.ok(!voiceOnly,'no call photo lookup');return photos||[];}},
  '@/lib/dokyeong/characters':{readLiveCharacter:async()=>({id:voiceOnly?characterModes.VOICE_ONLY_JIWOO_ID:'fixture-character',name:voiceOnly?'지우':'도경',prompt:linked?dialogue.PROJECT_CHARACTER_MARKER:'기존 설정',voice_id:'saved-voice'})},
  '@/lib/dokyeong/memory':{memoryContext:()=>read('memory'),serverRpc:(_,body)=>{assert.equal(body.action,'activity');return read('activity');}},
  '@/lib/dokyeong/project-context':{projectContext:()=>read('project')},
  '@/lib/dokyeong/project-dialogue':dialogue,
  '@/lib/dokyeong/project-reply':{projectReply:async raw=>{repairs.push(raw);return '알겠어.';}},
  '@/lib/dokyeong/samples':{relatedSampleContext:()=>read('samples')},
  '@/lib/dokyeong/time-context':{currentTimeContext:()=>''},
  '@/lib/dokyeong/photo-tool':{photoTool:{name:'send_character_photo'},parsePhotoCall:()=>null},
  '@/lib/dokyeong/photo-intent':{declinesPhoto:()=>false,photoFallbackAllowed:()=>{assert.ok(!voiceOnly,'no photo fallback');return false;},photoIntentContext:()=>'',photoRequestPrompt:()=>''},
  '@/lib/dokyeong/sleep-intent':{sleepIntent:()=>false},
  '@/lib/dokyeong/reply-jobs':{},
  '@/lib/dokyeong/reply-timing':{timingPrompt:'',timingPlan:()=>({awaySeconds:0})},
  '@/lib/dokyeong/voice-failure':{voiceFailure},
 };
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/api/dokyeong/respond/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Response,ReadableStream,TextEncoder,TextDecoder,AbortSignal,ArrayBuffer,Blob,
  WebSocket:Socket,performance:{now:()=>++clock},process:{env:{GEMINI_API_KEY:'test-only',ELEVENLABS_API_KEY:'test-only'}},
  console:{warn:()=>{},info:()=>{}},setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;},
  fetch:async(_url,init)=>{fetchCalled=true;modelBody=JSON.parse(init.body);return gates.headers.promise;},
 });
 const request=new Request('https://app.test/api/dokyeong/respond',{method:'POST',body:JSON.stringify({voice:realtime,realtime,callPhoto:photos?null:undefined,messages:[{role:'user',content:'안녕'}]})});
 const pending=exports.POST(request);
 const contextReady=()=>{gates.activity.resolve(null);for(const k of ['samples','memory','project'])gates[k].resolve('');};
 const frame=text=>input.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text}]}}]})+'\n\n'));
 return {gates,started,sockets,timers,pending,contextReady,frame,input,upstream,repairs,get fetchCalled(){return fetchCalled;},get modelBody(){return modelBody;}};
}

test('independent context reads start together and the voice socket opens before model headers',{timeout:3000},async()=>{
 const f=fixture();await tick();assert.deepEqual(f.started.sort(),['activity','memory','project','samples']);
 f.contextReady();await tick();assert.equal(f.sockets.length,1);assert.equal(f.fetchCalled,true);
 const socketUrl=new URL(f.sockets[0].url);
 assert.equal(socketUrl.pathname,'/v1/text-to-dialogue/stream-input');
 assert.equal(socketUrl.searchParams.get('model_id'),'eleven_v3_conversational');
 assert.equal(socketUrl.searchParams.get('output_format'),'pcm_24000');
 f.gates.headers.resolve(Response.json({},{status:500}));
 assert.equal((await f.pending).status,502);assert.equal(f.sockets[0].readyState,3);
});
test('the first sentence can play before later model text and all final audio is retained',{timeout:3000},async()=>{
 const f=fixture();await tick();f.contextReady();await tick();f.sockets[0].open();
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;const reader=response.body.getReader();
 f.frame('안녕.');const events=[];
 while(!events.some(e=>e.type==='audio')){
  const {value,done}=await reader.read();assert.equal(done,false);events.push(...new TextDecoder().decode(value).trim().split('\n').map(JSON.parse));
 }
 assert.ok(!events.some(e=>e.type==='text_done'));assert.equal(f.sockets[0].readyState,1);
 f.frame(' 계속 이야기할게.');f.input.close();
 while(true){const {value,done}=await reader.read();if(done)break;events.push(...new TextDecoder().decode(value).trim().split('\n').map(JSON.parse));}
 const complete=events.find(e=>e.type==='done');assert.equal(complete.text,'안녕. 계속 이야기할게.');assert.equal(complete.audioModel,'eleven_v3_conversational');
 assert.ok(complete.timings.firstAudioMs<complete.timings.textDoneMs);assert.ok(events.some(e=>e.type==='audio_done'));
 assert.equal(f.sockets.length,1);assert.equal(f.sockets[0].readyState,3);
});
test('cancelling the client stream closes the prewarmed socket',{timeout:3000},async()=>{
 const f=fixture();await tick();f.contextReady();await tick();f.sockets[0].open();
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;await response.body.cancel();await tick();assert.equal(f.sockets[0].readyState,3);
});
test('Jiwoo narration remains buffered until dialogue validation completes',{timeout:3000},async()=>{
 const f=fixture({linked:true});await tick();f.contextReady();await tick();f.sockets[0].open();
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('지우는 고개를 끄덕였다.');
 await tick();assert.equal(f.sockets[0].sent.filter(m=>m.inputs).length,0);assert.equal(f.repairs.length,0);
 f.input.close();const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(f.repairs.length,1);assert.equal(events.find(e=>e.type==='done').text,'알겠어.');
 assert.ok(!f.sockets[0].sent.some(m=>m.inputs?.some(i=>i.text.includes('끄덕였다'))));
});

test('the call photo choice reaches the screen separately and never enters speech or history',{timeout:3000},async()=>{
 const id='aabbccdd-1234-4321-aaaa-abcdef123456';
 const f=fixture({photos:[{id,situation:'장난칠 때'}]});
 await tick();f.contextReady();await tick();f.sockets[0].open();
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('[CALL_');f.frame('SCENE:1]');f.frame('\n안녕.');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(events[0],{type:'call_photo',id});
 assert.equal(events.find(e=>e.type==='done').text,'안녕.');
 assert.ok(f.sockets[0].sent.some(m=>m.inputs?.some(i=>i.text.includes('안녕.'))));
 assert.ok(!f.sockets[0].sent.some(m=>m.inputs?.some(i=>i.text.includes('CALL_SCENE'))));
});

test('standalone Jiwoo uses only voice and never requests project or image generation',{timeout:3000},async()=>{
 const text=fixture({voiceOnly:true,realtime:false});
 assert.equal((await text.pending).status,400);
 assert.equal(text.fetchCalled,false);assert.equal(text.sockets.length,0);
 const call=fixture({voiceOnly:true,photos:[]});
 await tick();assert.deepEqual(call.started.sort(),['memory','samples']);
 call.contextReady();await tick();call.sockets[0].open();
 assert.equal(call.modelBody.tools,undefined);
 assert.equal(call.modelBody.toolConfig,undefined);
 assert.doesNotMatch(call.modelBody.systemInstruction.parts[0].text,/send_character_photo/);
 call.gates.headers.resolve(new Response(call.upstream));
 const response=await call.pending;
 call.frame('*웃으며* 아, 형은 꼭 그렇게 말을 하더라.');call.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events.find(e=>e.type==='done').text,'아, 형은 꼭 그렇게 말을 하더라.');
 assert.ok(events.some(e=>e.type==='audio_done'));
 assert.ok(!events.some(e=>e.type==='call_photo'||e.type==='photo'));
 assert.deepEqual(call.repairs,[]);
});

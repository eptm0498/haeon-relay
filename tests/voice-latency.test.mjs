import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
import * as characterModes from '../lib/dokyeong/character-modes.ts';
import * as jiwooBedtime from '../lib/dokyeong/jiwoo-bedtime.ts';
import * as callScenes from '../lib/dokyeong/call-scenes.ts';
import {voiceFailure} from '../lib/dokyeong/voice-failure.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({linked=false,photos,standaloneJiwoo=false,realtime=true,wantVoice=realtime,requestId,models={},messages=[{role:'user',content:'안녕'}]}={}){
 const gates=Object.fromEntries(['activity','samples','memory','project','headers'].map(k=>[k,deferred()]));
 const started=[],sockets=[],timers=[],repairs=[],jobs=[],background=[];let input,clock=0,fetchCalled=false,modelBody,modelUrl;
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
  'next/server':{after:task=>{assert.ok(requestId);background.push(task);}},
  '@/lib/dokyeong/auth':{authenticated:()=>true,sameOrigin:()=>true,noStore:{'Cache-Control':'no-store'}},
  '@/lib/dokyeong/config':{liveConfig:{gemini:{responseModel:'fixture-model'},elevenlabs:{dialogueRealtimeModelId:'eleven_v3_conversational',dialogueOutputFormat:'pcm_24000'}}},
  '@/lib/dokyeong/model-settings':{
   liveModelOverrides:async()=>({textModel:null,voiceModel:null,speechModel:null,...models}),
   realtimeSpeechModel:model=>model===null?'eleven_v3_conversational':model==='eleven_v4_turbo'?model:null,
  },
  '@/lib/dokyeong/character-modes':characterModes,
  '@/lib/dokyeong/call-scenes':callScenes,
  '@/lib/dokyeong/jiwoo-bedtime':jiwooBedtime,
  '@/lib/dokyeong/call-photos':{readCallPhotos:async()=>{assert.ok(!standaloneJiwoo,'no call photo lookup');return photos||[];}},
  '@/lib/dokyeong/characters':{readLiveCharacter:async()=>({id:standaloneJiwoo?characterModes.STANDALONE_JIWOO_ID:'fixture-character',name:standaloneJiwoo?'지우':'도경',prompt:linked?dialogue.PROJECT_CHARACTER_MARKER:'기존 설정',voice_id:'saved-voice'})},
  '@/lib/dokyeong/memory':{memoryContext:()=>read('memory'),serverRpc:(_,body)=>{assert.equal(body.action,'activity');return read('activity');}},
  '@/lib/dokyeong/project-context':{projectContext:()=>read('project')},
  '@/lib/dokyeong/project-dialogue':dialogue,
  '@/lib/dokyeong/project-reply':{projectReply:async raw=>{repairs.push(raw);return '알겠어.';}},
  '@/lib/dokyeong/samples':{relatedSampleContext:()=>read('samples')},
  '@/lib/dokyeong/time-context':{currentTimeContext:()=>''},
  '@/lib/dokyeong/photo-tool':{photoTool:{name:'send_character_photo'},parsePhotoCall:()=>null},
  '@/lib/dokyeong/photo-intent':{declinesPhoto:()=>false,photoFallbackAllowed:()=>{assert.ok(!standaloneJiwoo,'no photo fallback');return false;},photoIntentContext:()=>'',photoRequestPrompt:()=>''},
  '@/lib/dokyeong/sleep-intent':{sleepIntent:()=>false},
  '@/lib/dokyeong/reply-jobs':{queueReply:async(...args)=>{jobs.push(args);},runReplyWorker:async id=>{jobs.push(id);}},
  '@/lib/dokyeong/reply-timing':{timingPrompt:'',timingPlan:()=>({awaySeconds:0})},
  '@/lib/dokyeong/voice-failure':{voiceFailure},
 };
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/api/dokyeong/respond/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Response,ReadableStream,TextEncoder,TextDecoder,AbortSignal,ArrayBuffer,Blob,
  WebSocket:Socket,performance:{now:()=>++clock},process:{env:{GEMINI_API_KEY:'test-only',ELEVENLABS_API_KEY:'test-only'}},
  console:{warn:()=>{},info:()=>{}},setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;},
  fetch:async(url,init)=>{fetchCalled=true;modelUrl=url;modelBody=JSON.parse(init.body);return gates.headers.promise;},
 });
 const request=new Request('https://app.test/api/dokyeong/respond',{method:'POST',body:JSON.stringify({voice:wantVoice,realtime,requestId,callPhoto:photos?null:undefined,messages})});
 const pending=exports.POST(request);
 const contextReady=()=>{gates.activity.resolve(null);for(const k of ['samples','memory','project'])gates[k].resolve('');};
 const frame=text=>input.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{text}]}}]})+'\n\n'));
 return {gates,started,sockets,timers,pending,contextReady,frame,input,upstream,repairs,jobs,background,get fetchCalled(){return fetchCalled;},get modelBody(){return modelBody;},get modelUrl(){return modelUrl;}};
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

test('standalone Jiwoo voice keeps its call-only processing and skips project and image generation',{timeout:3000},async()=>{
 const call=fixture({standaloneJiwoo:true,photos:[]});
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

test('Jiwoo gets conversational context and keeps its scene marker out of spoken dialogue',{timeout:3000},async()=>{
 const messages=[{role:'assistant',content:'더 꼭 안아줄까?'},{role:'user',content:'응, 그렇게 해줘.'}];
 const f=fixture({standaloneJiwoo:true,messages});
 await tick();f.contextReady();await tick();f.sockets[0].open();
 assert.match(f.modelBody.systemInstruction.parts[0].text,/직전 대화/);
 assert.deepEqual(f.modelBody.contents.map(turn=>turn.parts[0].text),messages.map(turn=>turn.content));
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('[CALL_');f.frame('SCENE:4]');f.frame('\n이리 와.');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(events[0],{type:'jiwoo_scene',id:'closeHug'});
 assert.equal(events.find(e=>e.type==='done').text,'이리 와.');
 assert.ok(!f.sockets[0].sent.some(m=>m.inputs?.some(i=>i.text.includes('CALL_SCENE'))));
});


test('text, muted calls and spoken calls use their saved Gemini and ElevenLabs selections',{timeout:3000},async()=>{
 const models={textModel:'gemini-3.7-flash',voiceModel:'gemini-3.5-flash-lite',speechModel:'eleven_v4_turbo'};
 for(const {realtime,wantVoice,expected} of [
  {realtime:false,wantVoice:false,expected:models.textModel},
  {realtime:true,wantVoice:false,expected:models.voiceModel},
  {realtime:true,wantVoice:true,expected:models.voiceModel},
 ]){
  const f=fixture({realtime,wantVoice,models});
  f.contextReady();await tick();
  assert.match(f.modelUrl,new RegExp('/'+expected+':streamGenerateContent'));
  assert.equal(f.sockets.length,wantVoice?1:0);
  if(wantVoice)assert.equal(new URL(f.sockets[0].url).searchParams.get('model_id'),models.speechModel);
  f.gates.headers.resolve(Response.json({},{status:404}));
  assert.equal((await f.pending).status,502);
 }
});
test('a selected HTTP speech model sends completed text for playback without opening a socket',{timeout:3000},async()=>{
 const f=fixture({models:{speechModel:'eleven_flash_v2_5'}});
 f.contextReady();await tick();assert.equal(f.sockets.length,0);
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;f.frame('안녕.');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events.find(e=>e.type==='text_done').text,'안녕.');
 assert.equal(events.find(e=>e.type==='audio_unavailable').hadAudio,false);
});


test('Jiwoo text chat enqueues the same reply job as the other characters',{timeout:3000},async()=>{
 const requestId='79c511c3-2b79-489d-81a3-b048fe6a3d3c';
 const messages=[{role:'assistant',content:'퇴근했어?'},{role:'user',content:'응, 방금 집 왔어.'}];
 const f=fixture({standaloneJiwoo:true,realtime:false,requestId,messages});
 const response=await f.pending;
 assert.equal(response.status,202);
 assert.deepEqual(await response.json(),{type:'queued',requestId});
 assert.equal(f.jobs[0][0],characterModes.STANDALONE_JIWOO_ID);
 assert.equal(f.jobs[0][1],requestId);
 assert.equal(JSON.stringify(f.jobs[0][2].messages),JSON.stringify(messages));
 await f.background[0]();
 assert.equal(f.jobs[1],requestId);
 assert.equal(f.fetchCalled,false);assert.equal(f.sockets.length,0);
});

test('Jiwoo direct text chat uses its text model and keeps chat reactions without call scenes',{timeout:3000},async()=>{
 const f=fixture({standaloneJiwoo:true,realtime:false,models:{textModel:'gemini-3.5-flash-lite'}});
 f.contextReady();await tick();
 assert.match(f.modelUrl,/gemini-3\.5-flash-lite:streamGenerateContent/);
 assert.match(f.modelBody.systemInstruction.parts[0].text,/\[문자 채팅\]/);
 assert.doesNotMatch(f.modelBody.systemInstruction.parts[0].text,/CALL_SCENE/);
 assert.equal(f.sockets.length,0);
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('아, 형은 진짜 ㅋㅋ');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events.find(e=>e.type==='done').text,'아, 형은 진짜 ㅋㅋ');
 assert.ok(!events.some(e=>e.type==='jiwoo_scene'||e.type==='audio'||e.type==='photo'));
});

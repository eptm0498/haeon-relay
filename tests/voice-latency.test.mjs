import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dialogue from '../lib/dokyeong/project-dialogue.ts';
import * as characterModes from '../lib/dokyeong/character-modes.ts';
import * as jiwooAlbum from '../lib/dokyeong/jiwoo-album.ts';
import * as jiwooPreferences from '../lib/dokyeong/jiwoo-preferences.ts';
import * as callScenes from '../lib/dokyeong/call-scenes.ts';
import {voiceFailure} from '../lib/dokyeong/voice-failure.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({linked=false,photos,standaloneJiwoo=false,realtime=true,wantVoice=realtime,speechTranscript=false,requestId,openingCallId,videoCall=false,cameraFrames,visualOnly=false,answered=false,callContext='',models={},messages=[{role:'user',content:'안녕'}]}={}){
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
  '@/lib/dokyeong/jiwoo-album':jiwooAlbum,
  '@/lib/dokyeong/jiwoo-preferences':jiwooPreferences,
  '@/lib/dokyeong/incoming-call':{incomingCallContext:async()=>callContext,incomingCallWork:async(action,id)=>{assert.equal(action,'greet');assert.equal(id,openingCallId);return answered?{id}:null;},isIncomingCallId:value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)},
  '@/lib/dokyeong/jiwoo-handoff':{jiwooHandoffContext:async()=>{assert.ok(standaloneJiwoo);return '넘겨온 통화 맥락';}},
  '@/lib/dokyeong/jiwoo-settings':{readJiwooPreferences:async()=>({...jiwooPreferences.defaultJiwooPreferences,chatPrompt:'문자 전용 예시',voicePrompt:'음성 전용 예시'})},
  '@/lib/dokyeong/call-photos':{readCallPhotos:async()=>photos||[]},
  '@/lib/dokyeong/characters':{readLiveCharacter:async()=>({id:standaloneJiwoo?characterModes.STANDALONE_JIWOO_ID:'fixture-character',name:standaloneJiwoo?'지우':'도경',prompt:linked?dialogue.PROJECT_CHARACTER_MARKER:'기존 설정',voice_id:'saved-voice'})},
  '@/lib/dokyeong/memory':{memoryContext:()=>read('memory'),serverRpc:(_,body)=>{assert.equal(body.action,'activity');return read('activity');}},
  '@/lib/dokyeong/project-context':{projectContext:()=>read('project')},
  '@/lib/dokyeong/project-dialogue':dialogue,
  '@/lib/dokyeong/project-reply':{projectReply:async raw=>{repairs.push(raw);return '알겠어.';}},
  '@/lib/dokyeong/samples':{relatedSampleContext:()=>read('samples')},
  '@/lib/dokyeong/time-context':{currentTimeContext:()=>''},
  '@/lib/dokyeong/photo-tool':{photoTool:{name:'send_character_photo'},parsePhotoCall:()=>null},
  '@/lib/dokyeong/photo-intent':{declinesPhoto:()=>false,photoFallbackAllowed:()=>{assert.ok(!standaloneJiwoo,'no photo fallback');return false;},photoIntentContext:()=>'',photoRequestPrompt:()=>'',wantsPhoto:()=>false},
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
 const request=new Request('https://app.test/api/dokyeong/respond',{method:'POST',body:JSON.stringify({voice:wantVoice,realtime,speechTranscript,requestId,openingCallId,videoCall,cameraFrames,visualOnly,callPhoto:photos?null:undefined,messages})});
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
 const photos=Array.from({length:42},(_,i)=>({id:`photo-${i+1}`,situation:`편집한 상황 ${i+1}`,tags:i===41?['포옹']:['일상']}));
 const f=fixture({standaloneJiwoo:true,messages,photos});
 await tick();f.contextReady();await tick();f.sockets[0].open();
 assert.match(f.modelBody.systemInstruction.parts[0].text,/편집한 상황 42/);
 assert.match(f.modelBody.systemInstruction.parts[0].text,/음성 전용 예시/);
 assert.match(f.modelBody.systemInstruction.parts[0].text,/16:00-21:00/);
 assert.doesNotMatch(f.modelBody.systemInstruction.parts[0].text,/문자 전용 예시/);
 assert.deepEqual(f.modelBody.contents.map(turn=>turn.parts[0].text),messages.map(turn=>turn.content));
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('[CALL_');f.frame('SCENE:1]');f.frame('\n이리 와.');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(events[0],{type:'jiwoo_photo',id:'photo-42'});
 assert.equal(events.find(e=>e.type==='done').text,'이리 와.');
 assert.ok(!f.sockets[0].sent.some(m=>m.inputs?.some(i=>i.text.includes('CALL_SCENE'))));
});

test('a generic home call scene selects from the home album without reading the marker aloud',{timeout:3000},async()=>{
 const id='aabbccdd-1234-4321-aaaa-abcdef123456';
 const photos=[
  {id,situation:'잠옷을 입고 소파에 앉아 있는 사진',tags:[jiwooAlbum.JIWOO_HOME_ALBUM_TAG],useFor:'both'},
  {id:'chat-only',situation:'침대 옆 사진',tags:[jiwooAlbum.JIWOO_HOME_ALBUM_TAG],useFor:'chat'},
  {id:'office',situation:'사무실 사진',tags:['회사'],useFor:'both'},
 ];
 const messages=[{role:'assistant',content:'나 집에 있어.'},{role:'user',content:'그래? 편히 쉬고 있어.'}];
 const f=fixture({standaloneJiwoo:true,photos,messages});
 await tick();f.contextReady();await tick();f.sockets[0].open();
 assert.match(f.modelBody.systemInstruction.parts[0].text,/\[CALL_SCENE:HOME\]/);
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('[CALL_SCENE:');f.frame('HOME]');f.frame('\n응, 형도 이제 좀 쉬어.');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(events[0],{type:'jiwoo_photo',id});
 assert.equal(events.find(e=>e.type==='done').text,'응, 형도 이제 좀 쉬어.');
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
 assert.doesNotMatch(f.modelBody.systemInstruction.parts[0].text,/CALL_SCENE|음성 전용 예시/);
 assert.match(f.modelBody.systemInstruction.parts[0].text,/문자 전용 예시/);
 assert.equal(f.sockets.length,0);
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('아, 형은 진짜 ㅋㅋ');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events.find(e=>e.type==='done').text,'아, 형은 진짜 ㅋㅋ');
 assert.ok(!events.some(e=>e.type==='jiwoo_scene'||e.type==='audio'||e.type==='photo'));
});

test('Jiwoo sends ordered stage directions and speech to the model in text, voice and video',{timeout:3000},async()=>{
 const messages=[
  {role:'assistant',content:'이리 와.'},
  {role:'user',content:'*지우가 조명을 켠다* 여기 앉을까? **도혁이 의자를 당긴다**'},
 ];
 for(const [realtime,videoCall] of [[false,false],[true,false],[true,true]]){
  const f=fixture({standaloneJiwoo:true,realtime,videoCall,messages});
  await tick();f.contextReady();await tick();
  assert.equal(f.modelBody.contents[0].parts[0].text,messages[0].content);
  const input=f.modelBody.contents.at(-1).parts[0].text;
  assert.ok(input.startsWith('[사용자 메시지 구분] '));
  assert.deepEqual(JSON.parse(input.slice('[사용자 메시지 구분] '.length)),[
   {kind:'지문',text:'지우가 조명을 켠다'},
   {kind:'대사',text:'여기 앉을까?'},
   {kind:'지문',text:'도혁이 의자를 당긴다'},
  ]);
  f.gates.headers.resolve(new Response(null,{status:500}));
  assert.equal((await f.pending).status,502);
 }
});

test('plain text, unmatched markup, bullets and multiplication are kept as dialogue',()=>{
 for(const text of ['그래', '*문을 연다', '**문을 연다*', '* 하나\n* 둘', '3*4*5', '별표 \\*야\\*']){
  assert.equal(characterModes.formatJiwooUserMessage(text),text);
 }
});

test('Jiwoo interprets recognition errors only for transcribed call turns',{timeout:3000},async()=>{
 const messages=[
  {role:'assistant',content:'오늘 뭐 했어?'},
  {role:'user',content:'치우야, 책상 좀 치우고 왔어. 시우가 내일 온대.'},
 ];
 for(const {options,expectsGuidance} of [
  {options:{speechTranscript:true},expectsGuidance:true},
  {options:{speechTranscript:true,videoCall:true,wantVoice:false},expectsGuidance:true},
  {options:{speechTranscript:false,videoCall:true},expectsGuidance:false},
  {options:{speechTranscript:true,realtime:false},expectsGuidance:false},
  {options:{speechTranscript:true,standaloneJiwoo:false},expectsGuidance:false},
 ]){
  const f=fixture({standaloneJiwoo:true,realtime:true,messages,...options});
  f.contextReady();await tick();
  const systemPrompt=f.modelBody.systemInstruction.parts[0].text;
  assert.equal(systemPrompt.includes(characterModes.JIWOO_SPEECH_TRANSCRIPT_PROMPT),expectsGuidance);
  assert.equal(f.modelBody.contents.at(-1).parts[0].text,messages[1].content);
  f.gates.headers.resolve(new Response(null,{status:500}));
  assert.equal((await f.pending).status,502);
 }
});

test('only an answered Jiwoo call starts with one 여보세요 before the contextual dialogue', { timeout: 3000 }, async () => {
 const openingCallId = 'aabbccdd-1234-4321-aaaa-abcdef123456';
 const unanswered = fixture({standaloneJiwoo:true,openingCallId,messages:[]});
 assert.equal((await unanswered.pending).status,409);
 assert.equal(unanswered.fetchCalled,false);
 assert.equal(unanswered.sockets.length,0);
 const answered = fixture({standaloneJiwoo:true,openingCallId,answered:true,messages:[]});
 await tick();answered.contextReady();await tick();answered.sockets[0].open();
 assert.match(answered.modelBody.systemInstruction.parts[0].text,/여보세요\?/);
 assert.doesNotMatch(answered.modelBody.systemInstruction.parts[0].text,/\[음성인식 문맥\]/);
 assert.equal(answered.modelBody.contents[0].parts[0].text,'[수신 통화가 연결됨]');
 answered.gates.headers.resolve(new Response(answered.upstream));
 const response = await answered.pending;
 assert.equal(response.status,200);
 const reader = response.body.getReader();
 const readEvent = async () => {
  const { value, done } = await reader.read();
  return done ? null : JSON.parse(new TextDecoder().decode(value));
 };
 assert.deepEqual(await readEvent(), { type:'delta', text:'여보세요?' });
 assert.equal((await readEvent()).type,'audio');
 answered.frame('여보세요? 형, 목소리 듣고 싶어서 전화했어.');answered.input.close();
 const events = [];
 for (let event; (event = await readEvent());) events.push(event);
 assert.equal(events.at(-1).text,'여보세요? 형, 목소리 듣고 싶어서 전화했어.');
 const spoken = answered.sockets[0].sent.flatMap(frame => frame.inputs ?? []).map(input => input.text).join(' ');
 assert.equal(spoken,'여보세요? 형, 목소리 듣고 싶어서 전화했어.');
});

test('Jiwoo sends the hangup signal after the farewell audio and keeps the marker out of the conversation', { timeout: 3000 }, async () => {
 for (const videoCall of [false, true]) {
  const f=fixture({standaloneJiwoo:true,videoCall,messages:[{role:'user',content:'나 이제 자러 갈게. 잘 자.'}]});
  await tick();f.contextReady();await tick();f.sockets[0].open();
  assert.match(f.modelBody.systemInstruction.parts[0].text,/\[통화 마무리\]/);
  f.gates.headers.resolve(new Response(f.upstream));
  const response=await f.pending;
  f.frame('응, 잘 자 형.\n[CALL_');f.frame('END]');f.input.close();
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).endCall,true);
  assert.equal(events.at(-1).text,'응, 잘 자 형.');
  assert.equal(events.at(-2).type,'audio_done');
  assert.ok(events.some(event=>event.type==='audio'));
  assert.doesNotMatch(JSON.stringify(events),/CALL_END/);
  assert.doesNotMatch(JSON.stringify(f.sockets[0].sent),/CALL_END/);
 }
});

test('a marker inside dialogue, a text reply, and an incoming greeting cannot end the call', { timeout: 3000 }, async () => {
 for (const [options, text] of [
  [{}, '응.\n[CALL_END]\n그래서 어디까지 얘기했지?'],
  [{realtime:false}, '응.\n[CALL_END]'],
  [{openingCallId:'aabbccdd-1234-4321-aaaa-abcdef123456', answered:true, messages:[]}, '여보세요.\n[CALL_END]'],
 ]) {
  const f=fixture({standaloneJiwoo:true,wantVoice:false,...options});
  await tick();f.contextReady();await tick();
  f.gates.headers.resolve(new Response(f.upstream));
  const response=await f.pending;
  f.frame(text);f.input.close();
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type,'done');
  assert.equal(events.at(-1).endCall,undefined);
  assert.doesNotMatch(JSON.stringify(events),/CALL_END/);
 }
});

test('Jiwoo receives the real missed-call context in regular voice and text replies', { timeout: 3000 }, async () => {
 const callContext = '[실제 최근 수신 전화 기록] 형이 제한 시간 안에 받지 못했어.';
 for (const realtime of [true,false]) {
  const f=fixture({standaloneJiwoo:true,realtime,callContext});
  await tick();f.contextReady();await tick();
  assert.ok(f.modelBody.systemInstruction.parts[0].text.includes(callContext));
  f.gates.headers.resolve(new Response(null,{status:500}));
  assert.equal((await f.pending).status,502);
 }
});

test('Jiwoo distinguishes text, voice and video while keeping the audio transport', { timeout: 3000 }, async () => {
 for (const [realtime,videoCall,mode] of [[false,true,'문자 채팅'],[true,false,'음성 통화'],[true,true,'영상 통화']]) {
  const f=fixture({standaloneJiwoo:true,realtime,videoCall});
  await tick();f.contextReady();await tick();
  const prompt=f.modelBody.systemInstruction.parts[0].text;
  assert.ok(prompt.includes('[현재 대화 모드: '+mode+']'));
  assert.match(prompt,/답변에 모드명.*붙이지 마/);
  if(realtime&&videoCall)assert.match(prompt,/미리 등록된 반복 영상/);
  f.gates.headers.resolve(new Response(null,{status:500}));
  assert.equal((await f.pending).status,502);
 }
});

test('Jiwoo reads opted-in camera frames without adding them to past chat messages', { timeout: 3000 }, async () => {
 const cameraFrames = [
  {mimeType:'image/jpeg',data:'A'.repeat(100)},
  {mimeType:'image/jpeg',data:'B'.repeat(100)},
  {mimeType:'image/jpeg',data:'C'.repeat(100)},
 ];
 const f=fixture({standaloneJiwoo:true,realtime:true,videoCall:true,cameraFrames});
 await tick();f.contextReady();await tick();
 const prompt=f.modelBody.systemInstruction.parts[0].text;
 assert.match(prompt,/시간순으로 촬영된 최근 정지 프레임/);
 const parts=f.modelBody.contents.at(-1).parts;
 assert.deepEqual(parts.filter(part=>part.inlineData).map(part=>part.inlineData.data),cameraFrames.map(frame=>frame.data));
 assert.equal(f.modelBody.contents[0].parts[0].text,'안녕');
 f.gates.headers.resolve(new Response(null,{status:500}));
 assert.equal((await f.pending).status,502);
});

test('Jiwoo can react to a camera scene change without a fabricated persistent user utterance', { timeout: 3000 }, async () => {
 const cameraFrames=[{mimeType:'image/jpeg',data:'A'.repeat(100)}];
 const f=fixture({standaloneJiwoo:true,realtime:true,videoCall:true,cameraFrames,visualOnly:true,
   messages:[{role:'assistant',content:'그래 형.'}]});
 await tick();f.contextReady();await tick();
 assert.match(f.modelBody.systemInstruction.parts[0].text,/움직임을 보고 먼저 반응/);
 assert.equal(f.modelBody.contents.at(-1).role,'user');
 assert.match(f.modelBody.contents.at(-1).parts[0].text,/카메라에서 움직임이 감지됐어/);
 assert.equal(f.modelBody.contents.at(-1).parts.filter(part=>part.inlineData).length,1);
 f.gates.headers.resolve(new Response(null,{status:500}));
 assert.equal((await f.pending).status,502);
});

test('Jiwoo call options exclude chat-only photos, and no scene selection keeps the displayed photo', { timeout: 3000 }, async () => {
 const photos=[
  {id:'chat',situation:'앨범 전용 계곡',tags:['계곡'],useFor:'chat'},
  {id:'office',situation:'시청 책상',tags:['회사'],useFor:'call'},
 ];
 const f=fixture({standaloneJiwoo:true,wantVoice:false,photos});
 f.contextReady();await tick();
 assert.match(f.modelBody.systemInstruction.parts[0].text,/시청 책상/);
 assert.doesNotMatch(f.modelBody.systemInstruction.parts[0].text,/앨범 전용 계곡/);
 f.gates.headers.resolve(new Response(f.upstream));
 const response=await f.pending;
 f.frame('[CALL_SCENE:0]\n지금 괜찮아.');f.input.close();
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events.find(event=>event.type==='done').text,'지금 괜찮아.');
 assert.ok(!events.some(event=>event.type==='jiwoo_photo'));
});

test('Jiwoo call start uses Korea time and the start day of a window crossing midnight', () => {
 const photos=[
  {id:'bed',useFor:'call',days:'weekdays',startTime:'23:00',endTime:'07:00'},
  {id:'work',useFor:'both',days:'weekdays',startTime:'09:00',endTime:'18:00'},
  {id:'chat',useFor:'chat',days:'daily',startTime:'00:00',endTime:'23:59'},
  {id:'untimed',useFor:'call'},
 ];
 const ids=now=>jiwooAlbum.scheduledCallPhotos(photos,new Date(now)).map(photo=>photo.id);
 assert.deepEqual(ids('2026-11-13T16:00:00Z'),['bed']); // Saturday 01:00 KST, from Friday.
 assert.deepEqual(ids('2026-11-14T16:00:00Z'),[]); // Sunday 01:00 KST, from Saturday.
 assert.deepEqual(ids('2026-11-16T00:00:00Z'),['work']);
 assert.deepEqual(ids('2026-11-16T09:00:00Z'),[]);
});

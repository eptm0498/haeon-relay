import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {voiceFailure,backupVoiceNotice} from '../lib/dokyeong/voice-failure.ts';

test('billing and credit failures are distinct and never expose upstream details',()=>{
 const payment=voiceFailure({detail:{status:'payment_issue',message:'private billing details'}},401);
 assert.equal(payment.code,'payment_issue');assert.equal(payment.terminal,true);
 assert.match(payment.message,/결제 문제/);assert.doesNotMatch(payment.message,/private/);
 assert.equal(voiceFailure({detail:{status:'quota_exceeded'}},401).code,'quota_exceeded');
 assert.match(backupVoiceNotice('payment_issue'),/임시 OpenAI 음성/);
});

async function speech(responses,{backup=true}={}){
 const calls=[];const exports={};
 const mocks={
  '@/lib/dokyeong/auth':{authenticated:()=>true,sameOrigin:()=>true,noStore:{'Cache-Control':'no-store'}},
  '@/lib/dokyeong/config':{liveConfig:{elevenlabs:{dialogueModelId:'eleven_v4',fallbackModelId:'eleven_flash_v2_5',outputFormat:'mp3_44100_128'}}},
  '@/lib/dokyeong/characters':{readLiveCharacter:async()=>({voice_id:'saved-character-voice'})},
  '@/lib/dokyeong/voice-failure':{voiceFailure},
 };
 const source=fs.readFileSync(new URL('../app/api/dokyeong/tts/route.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Response,AbortSignal,
  process:{env:{ELEVENLABS_API_KEY:'test-only',...(backup?{OPENAI_API_KEY:'test-only'}:{})}},
  console:{warn:()=>{}},fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});assert.ok(responses.length,'unexpected paid retry');return responses.shift();}
 });
 const result=await exports.POST(new Request('https://app.test/api/tts',{method:'POST',body:JSON.stringify({text:'목소리 확인할게.'})}));
 return {result,calls};
}
const blocked=()=>Response.json({detail:{status:'payment_issue',message:'private account details'}},{status:401});
const audio=()=>new Response(new Uint8Array([73,68,51,1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});

test('payment block immediately uses backup audio instead of repeating ElevenLabs calls',async()=>{
 const {result,calls}=await speech([blocked(),audio()]);
 assert.equal(result.status,200);assert.equal(calls.length,2);
 assert.ok(calls[1].url.startsWith('https://api.openai.com/'));
 assert.equal(calls[1].body.input,'목소리 확인할게.');
 assert.equal(result.headers.get('X-Dokyeong-TTS-Fallback'),'payment_issue');
 assert.equal(result.headers.get('X-Dokyeong-TTS-Provider'),'openai');
 assert.equal((await result.arrayBuffer()).byteLength,6);
});
test('healthy preferred voice returns without invoking backup',async()=>{
 const {result,calls}=await speech([audio()]);
 assert.equal(calls.length,1);assert.equal(calls[0].body.inputs[0].voice_id,'saved-character-voice');
 assert.equal(result.headers.get('X-Dokyeong-TTS-Model'),'eleven_v4');
 assert.equal(result.headers.get('X-Dokyeong-TTS-Provider'),null);
});
test('transient model failure retains the character voice through Flash',async()=>{
 const {result,calls}=await speech([Response.json({},{status:500}),audio()]);
 assert.equal(calls.length,2);assert.equal(calls[1].body.model_id,'eleven_flash_v2_5');
 assert.ok(calls[1].url.includes('saved-character-voice'));
 assert.equal(result.headers.get('X-Dokyeong-TTS-Model'),'eleven_flash_v2_5');
});
test('both unavailable providers return a clear payment explanation',async()=>{
 const {result,calls}=await speech([blocked(),Response.json({error:'private'},{status:429})]);
 assert.equal(calls.length,2);assert.equal(result.status,503);
 const failure=await result.json();assert.equal(failure.code,'payment_issue');
 assert.match(failure.error,/결제 문제/);assert.doesNotMatch(failure.error,/private/);
});

function bridgeHarness(){
 const sockets=[],timers=[];const exports={};
 class Socket extends EventTarget{
  readyState=0;sent=[];
  constructor(){super();sockets.push(this);}
  send(text){this.sent.push(JSON.parse(text));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  message(value){const event=new Event('message');event.data=JSON.stringify(value);this.dispatchEvent(event);}
 }
 const source=fs.readFileSync(new URL('../app/api/dokyeong/respond/route.ts',import.meta.url),'utf8')+'\nexports.testBridge=createDialogueBridge;';
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:name=>name.endsWith('/config')?{liveConfig:{elevenlabs:{dialogueRealtimeModelId:'eleven_v4_turbo',dialogueOutputFormat:'pcm_24000'}}}:name.endsWith('/voice-failure')?{voiceFailure}:{},
  process:{env:{ELEVENLABS_API_KEY:'test-only'}},console:{warn:()=>{}},WebSocket:Socket,ArrayBuffer,TextDecoder,Blob,
  setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}
 });
 const events=[];const controller=new AbortController();
 const bridge=exports.testBridge(event=>events.push(event),controller.signal,'saved-voice');
 return {bridge,socket:sockets[0],timers,events};
}
test('realtime payment failure finishes cleanly and preserves fallback reason',async()=>{
 const {bridge,socket}=bridgeHarness();socket.open();bridge.push('목소리 확인할게.');
 socket.message({error:'payment_issue'});await Promise.resolve();
 const result=await bridge.finish();
 assert.equal(result.completed,false);assert.equal(result.failure.code,'payment_issue');
 assert.equal(socket.readyState,3);
});
test('a websocket that never opens has a bounded finish',async()=>{
 const {bridge,timers}=bridgeHarness();bridge.push('확인할게.');
 const openTimeout=timers.find(t=>t.ms===5000);assert.ok(openTimeout);openTimeout.fn();
 const result=await bridge.finish();assert.equal(result.completed,false);
});

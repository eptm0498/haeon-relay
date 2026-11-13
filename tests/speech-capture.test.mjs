import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { SpeechTurnBuffer, encodeSpeechWav } from '../lib/dokyeong/speech-capture.ts';

const rate = 48000;
const frame = level => Float32Array.from({length: rate / 50}, (_, i) => i % 2 ? level : -level);
const quiet = frame(0.001), speech = frame(0.01);

test('voice captures the quiet onset and tolerates a pause mid-sentence', () => {
  const capture = new SpeechTurnBuffer(rate);
  for (let i = 0; i < 20; i++) assert.deepEqual(capture.push(quiet, false), {});
  const firstSyllable = frame(0.003);
  assert.deepEqual(capture.push(firstSyllable, false), {});
  for (let i = 0; i < 2; i++) assert.deepEqual(capture.push(speech, false), {});
  assert.deepEqual(capture.push(speech, false), {started:true});
  for (let i = 0; i < 49; i++) assert.deepEqual(capture.push(quiet, false), {});
  assert.deepEqual(capture.push(speech, false), {});
  for (let i = 0; i < 54; i++) assert.deepEqual(capture.push(quiet, false), {});
  const result = capture.push(quiet, false).completed;
  assert.ok(result.includes(firstSyllable));
  assert.equal(result.at(-12), speech);
  assert.equal(capture.recording, false);
});

test('short quiet answers are captured; an isolated click or playback echo is ignored', () => {
  const capture = new SpeechTurnBuffer(rate);
  capture.push(frame(0.4), false);
  for (let i = 0; i < 30; i++) assert.deepEqual(capture.push(quiet, false), {});
  for (let i = 0; i < 20; i++) assert.deepEqual(capture.push(frame(0.012), true), {});
  for (let i = 0; i < 20; i++) capture.push(quiet, false);
  const answer = frame(0.006);
  for (let i = 0; i < 2; i++) assert.deepEqual(capture.push(answer, false), {});
  assert.equal(capture.push(answer, false).started, true);
  for (let i = 0; i < 54; i++) capture.push(quiet, false);
  assert.ok(capture.push(quiet, false).completed.includes(answer));
});

test('worklet packets contain consecutive samples and WAV preserves the clip duration', async () => {
  let Processor;
  const packets = [];
  vm.runInNewContext(fs.readFileSync(new URL('../public/live-mic-capture-v1.js',import.meta.url),'utf8'),{
    Float32Array,sampleRate:44100,AudioWorkletProcessor:class{port={postMessage:packet=>packets.push(packet)};},
    registerProcessor:(name,ctor)=>{assert.equal(name,'live-mic-capture');Processor=ctor;},
  });
  const worklet=new Processor();
  const samples=Float32Array.from({length:128*21},(_,i)=>i/4000);
  for(let i=0;i<samples.length;i+=128)worklet.process([[samples.subarray(i,i+128)]]);
  assert.equal(packets.length,3);
  assert.deepEqual(packets.flatMap(x=>Array.from(x)),Array.from(samples.slice(0,882*3)));
  const wav=encodeSpeechWav(packets,44100);
  const header=new DataView(await wav.arrayBuffer());
  assert.equal(wav.type,'audio/wav');
  assert.equal(header.getUint32(0),0x52494646);
  assert.equal(header.getUint32(24,true),24000);
  assert.equal(header.getUint32(40,true),3*480*2);
  assert.ok(header.getInt16(44+500*2,true)>0);
});

function transcriptionFixture({ fetch, elevenKey = 'eleven-test', model = null }) {
  const source=fs.readFileSync(new URL('../app/api/dokyeong/transcribe/route.ts',import.meta.url),'utf8');
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
    exports,require:name=>name.endsWith('/auth')?{authenticated:()=>true,sameOrigin:()=>true,noStore:{}}:name.endsWith('/model-settings')?{liveModelOverrides:async()=>({transcriptionModel:model})}:{liveConfig:{elevenlabs:{transcriptionModelId:'scribe_v3'}}},
    File,FormData,Response,AbortSignal,process:{env:{OPENAI_API_KEY:'openai-test',ELEVENLABS_API_KEY:elevenKey}},console:{warn:()=>{}},
    fetch,
  });
  return async ()=>{
    const form=new FormData();
    form.append('audio',new File([new Uint8Array(1500)],'speech.wav',{type:'audio/wav'}));
    return exports.POST(new Request('https://fixture.test/api/dokyeong/transcribe',{method:'POST',body:form}));
  };
}

test('Scribe transcribes Korean WAV and does not retry a successful empty transcript', async () => {
  const requests=[];
  const call=transcriptionFixture({fetch:async (url,req)=>{
    requests.push({url,...req});
    return Response.json({text:requests.length===1?' 응, 형. ':''});
  }});
  assert.deepEqual(await (await call()).json(),{text:'응, 형.',model:'scribe_v3'});
  assert.deepEqual(await (await call()).json(),{text:'',model:'scribe_v3'});
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,'https://api.elevenlabs.io/v1/speech-to-text');
  assert.equal(requests[0].headers['xi-api-key'],'eleven-test');
  assert.equal(requests[0].body.get('model_id'),'scribe_v3');
  assert.equal(requests[0].body.get('language_code'),'ko');
  assert.equal(requests[0].body.get('file').name,'speech.wav');
});

test('Scribe errors surface without sending the recording to another provider', async () => {
  const requests=[];
  const call=transcriptionFixture({fetch:async url=>{
    requests.push(url);
    return Response.json({},{status:403});
  }});
  const response=await call();
  assert.equal(response.status,502);
  assert.match((await response.json()).error,/일레븐랩스.*권한/);
  assert.deepEqual(requests,['https://api.elevenlabs.io/v1/speech-to-text']);
  const withoutElevenKey=transcriptionFixture({elevenKey:'',fetch:async url=>{requests.push(url);}});
  assert.equal((await withoutElevenKey()).status,503);
  assert.equal(requests.length,1);
});


test('Scribe v2 selection is sent to the same Korean transcription endpoint',async()=>{
 const call=transcriptionFixture({model:'scribe_v2',fetch:async(_url,req)=>{
  assert.equal(req.body.get('model_id'),'scribe_v2');
  assert.equal(req.body.get('language_code'),'ko');
  return Response.json({text:'안녕'});
 }});
 assert.deepEqual(await (await call()).json(),{text:'안녕',model:'scribe_v2'});
});

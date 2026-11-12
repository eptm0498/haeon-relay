import {execFileSync,spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';

execFileSync(process.execPath,['--test','tests/voice-recovery.test.mjs','tests/voice-latency.test.mjs'],{stdio:'inherit'});

// One explicit comparison per opt-in deployment. No synthetic conversation,
// generated audio, credentials or private prompts are written to logs/history.
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-latency]')){
 const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();
 if(!secret)throw Error('Latency verification configuration unavailable');
 const local='http://127.0.0.1:3196',production='https://haeon-relay.vercel.app';
 const expiry=String(Date.now()+300000),signature=createHmac('sha256',secret).update(expiry).digest('hex');
 const headers=origin=>({Origin:origin,Cookie:`dokyeong_live_session=${expiry}.${signature}`,'Content-Type':'application/json'});
 const call=(origin,path,body)=>fetch(origin+path,{headers:headers(origin),...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(75000)});
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3196','-H','127.0.0.1'],{stdio:'ignore'});
 async function measure(origin,label,characterId){
  const status=await call(origin,'/api/dokyeong/status');
  const expectedModel=(await status.json()).audio?.realtimeModel;
  if(!expectedModel)throw Error('Missing realtime speech configuration');
  const start=performance.now();let firstTextMs,firstAudioMs,model,serverTimings,completed=false,code,audioChunks=0,bytes=0;
  const response=await call(origin,'/api/dokyeong/respond',{characterId,voice:true,realtime:true,messages:[{role:'user',content:'사진 보내지 말고, 음성 속도 확인용으로 인사 한 문장만 해줘.'}]});
  if(!response.ok||!response.body){
   const failure=await response.json().catch(()=>({}));
   console.log('VOICE_LATENCY_PROBE',JSON.stringify({label,state:'unavailable',status:response.status,code:failure.code}));return;
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  while(true){
   const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});
   let end;while((end=pending.indexOf('\n'))>=0){
    const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;
    const event=JSON.parse(line),elapsed=Math.round(performance.now()-start);
    if(event.type==='delta'&&firstTextMs===undefined)firstTextMs=elapsed;
    if(event.type==='audio'){
     if(firstAudioMs===undefined)firstAudioMs=elapsed;
     model=event.model;audioChunks++;const n=Buffer.from(event.data,'base64').length;
     if(n%2!==0)throw Error('Invalid PCM audio boundary');bytes+=n;
    }
    if(event.type==='audio_done')completed=true;
    if(event.type==='audio_unavailable')code=event.code||'voice_unavailable';
    if(event.type==='error')code='response_error';
    if(event.type==='done')serverTimings=event.timings;
   }
  }
  console.log('VOICE_LATENCY_PROBE',JSON.stringify({label,state:completed?'streamed':'unavailable',firstTextMs,firstAudioMs,totalMs:Math.round(performance.now()-start),model,audioChunks,bytes,code,serverTimings}));
  if(completed&&(model!==expectedModel||!bytes))throw Error('Unexpected realtime speech configuration');
  if(label==='updated'&&audioChunks&&!completed)throw Error('Updated audio was truncated');
 }
 try{
  let ready=false;for(let i=0;i<40;i++){try{const r=await call(local,'/api/dokyeong/status');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!ready)throw Error('Latency verification server did not start');
  const listing=await call(local,'/api/dokyeong/characters');if(!listing.ok)throw Error('Character discovery failed');
  const data=await listing.json(),character=data.characters.find(c=>c.name==='도경')||data.characters.find(c=>c.is_default)||data.characters[0];
  if(!character)throw Error('Character unavailable');
  // The production alias still points to the previous deployment during build.
  // These are two individual samples, not a statistically valid speed claim.
  for(const [origin,label] of [[production,'production'],[local,'updated']]){
   try{await measure(origin,label,character.id);}
   catch(error){if(label==='updated'&&/truncated|Unexpected realtime|Invalid PCM/.test(error.message||''))throw error;console.log('VOICE_LATENCY_PROBE',JSON.stringify({label,state:'unavailable',reason:'probe_failed'}));}
  }
 }finally{server.kill('SIGTERM');}
}

// Explicit, minimal operational probe. Credentials and generated audio stay private.
// Ordinary builds never call a paid provider.
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-audio]')) {
 const key=process.env.ELEVENLABS_API_KEY;
 if(!key)console.log('LIVE_AUDIO_DIAGNOSTIC '+JSON.stringify({configured:false}));
 else {
  const headers={'xi-api-key':key,'Content-Type':'application/json'};
  const subscription=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers,signal:AbortSignal.timeout(10000)});
  const account=await subscription.json().catch(()=>({}));
  console.log('LIVE_AUDIO_ACCOUNT '+JSON.stringify({status:subscription.status,tier:account.tier,used:account.character_count,limit:account.character_limit,nextReset:account.next_character_count_reset_unix}));
  const response=await fetch('https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=mp3_44100_128',{
   method:'POST',headers,body:JSON.stringify({model_id:'eleven_v4',inputs:[{text:'목소리 확인할게.',voice_id:process.env.DOKYEONG_VOICE_ID||'peTGXjUdPy5VJNYTcdea'}]}),signal:AbortSignal.timeout(20000)
  });
  if(response.ok){const bytes=(await response.arrayBuffer()).byteLength;console.log('LIVE_AUDIO_PROVIDER '+JSON.stringify({status:response.status,bytes}));}
  else {const failure=await response.json().catch(()=>({}));console.log('LIVE_AUDIO_PROVIDER '+JSON.stringify({status:response.status,code:failure.detail?.status||failure.code||'unknown'}));}
 }
}
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-audio-routes]')){
 const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();
 if(!secret)throw Error('Audio verification credentials unavailable');
 const expiry=String(Date.now()+120000),signature=createHmac('sha256',secret).update(expiry).digest('hex');
 const origin='http://127.0.0.1:3198';
 const headers={Origin:origin,Cookie:`dokyeong_live_session=${expiry}.${signature}`,'Content-Type':'application/json'};
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3198','-H','127.0.0.1'],{stdio:['ignore','ignore','ignore']});
 const call=(path,body)=>fetch(origin+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(65000)});
 try{
  let ready=false;for(let i=0;i<30;i++){try{await call('/api/dokyeong/status');ready=true;break;}catch{await new Promise(r=>setTimeout(r,300));}}
  if(!ready)throw Error('Audio verification server did not start');
  const response=await call('/api/dokyeong/characters');
  if(!response.ok)throw Error('Audio character read failed');
  const data=await response.json(),character=data.characters.find(c=>c.is_default)||data.characters[0];
  if(!character)throw Error('Audio character unavailable');
  const anonymous=await fetch(origin+'/api/dokyeong/tts',{method:'POST',headers:{Origin:origin}});
  if(anonymous.status!==401)throw Error('TTS authentication boundary failed');
  const tts=await call('/api/dokyeong/tts',{characterId:character.id,text:'목소리 확인할게.'});
  if(!tts.ok) {const e=await tts.json().catch(()=>({}));throw Error('TTS verification failed: '+tts.status+' '+(e.code||'unknown'));}
  if(!tts.headers.get('Content-Type')?.startsWith('audio/'))throw Error('TTS response is not audio');
  const bytes=new Uint8Array(await tts.arrayBuffer());
  const mp3=(bytes[0]===73&&bytes[1]===68&&bytes[2]===51)||(bytes[0]===255&&(bytes[1]&224)===224);
  if(bytes.length<1000||!mp3)throw Error('TTS MP3 invalid or empty');
  console.log('LIVE_AUDIO_ROUTE_OK '+JSON.stringify({bytes:bytes.length,model:tts.headers.get('X-Dokyeong-TTS-Model'),provider:tts.headers.get('X-Dokyeong-TTS-Provider')||'elevenlabs',fallback:tts.headers.get('X-Dokyeong-TTS-Fallback')}));
  // This request reads context but supplies no requestId, so it cannot save or
  // enqueue a real user message, activity, or notification.
  const reply=await call('/api/dokyeong/respond',{characterId:character.id,voice:true,realtime:true,messages:[{role:'user',content:'지금 음성 확인 중이야. 짧게 대답해줘.'}]});
  if(!reply.ok)throw Error('Voice response verification failed: '+reply.status);
  const events=(await reply.text()).split('\n').filter(Boolean).map(line=>JSON.parse(line));
  if(!events.some(e=>e.type==='text_done')||!events.some(e=>e.type==='done'))throw Error('Voice response did not finish');
  console.log('LIVE_AUDIO_REPLY_OK '+JSON.stringify({textComplete:true,audioState:events.find(e=>e.type==='audio_done'||e.type==='audio_unavailable')?.type,failureCode:events.find(e=>e.type==='audio_unavailable')?.code}));
 }finally{server.kill('SIGTERM');}
}

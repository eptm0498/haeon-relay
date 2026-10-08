// Explicit, minimal operational probe. Credentials and generated audio stay private.
// Ordinary builds never call a paid provider.
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

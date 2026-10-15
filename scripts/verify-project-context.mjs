import {execFileSync,spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
execFileSync(process.execPath,['--test','tests/project-context.test.mjs'],{stdio:'inherit'});
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-jiwoo]')){
 const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();if(!secret)throw Error('Verification configuration unavailable');
 const origin='http://127.0.0.1:3197',expiry=String(Date.now()+180000);
 const headers={Origin:origin,Cookie:`dokyeong_live_session=${expiry}.${createHmac('sha256',secret).update(expiry).digest('hex')}`,'Content-Type':'application/json'};
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3197','-H','127.0.0.1'],{stdio:'ignore'});
 const call=(path,body)=>fetch(origin+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
 try{
  for(let i=0;i<40;i++){try{await call('/api/dokyeong/status');break;}catch{await new Promise(r=>setTimeout(r,250));}}
  const listing=await call('/api/dokyeong/characters');assert.equal(listing.status,200);
  const character=(await listing.json()).characters.find(c=>c.name==='지우');assert.ok(character);assert.equal(character.voice_name,'승');
  const source=await call('/api/dokyeong/project-context?characterId='+character.id);assert.equal(source.status,200);
  const status=await source.json();assert.equal(status.sourceTitle,'대화 시작');assert.ok(status.version>0);assert.ok(!('messages' in status));
  const anonymous=await fetch(origin+'/api/dokyeong/project-context?characterId='+character.id);assert.equal(anonymous.status,401);
  const cross=await fetch(origin+'/api/dokyeong/project-context',{method:'POST',headers:{...headers,Origin:'https://foreign.invalid'},body:'{}'});assert.equal(cross.status,403);
  const zip=await fetch(origin+'/jiwoo-project-bridge.zip');assert.equal(zip.status,200);const bytes=new Uint8Array(await zip.arrayBuffer());assert.equal(bytes[0],80);assert.equal(bytes[1],75);
  // No request ID: response generation cannot queue a user-history write.
  const reply=await call('/api/dokyeong/respond',{characterId:character.id,voice:false,realtime:true,messages:[{role:'user',content:'우리 지금 어떤 사이고 커플 계정은 누가 관리하기로 했지? 소설 지문 없이 네 말만 해줘.'}]});
  assert.equal(reply.status,200);const events=(await reply.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(events.some(e=>e.type==='done'));assert.ok(!events.some(e=>e.type==='error'));
  const answer=events.filter(e=>e.type==='delta').map(e=>e.text).join('');assert.ok(answer.trim());assert.ok(!/지우가|지우는|\*|태성:/.test(answer));
  console.log('JIWOO_ROUTES_OK',JSON.stringify({privateSource:true,zip:true,dialogue:true,voice:'승',messageCount:status.messageCount,partial:status.partial}));
  const speech=await call('/api/dokyeong/tts',{characterId:character.id,text:'ㅇㅇ 알겠음 ㅋㅋ'});
  if(speech.ok){assert.ok(speech.headers.get('Content-Type')?.startsWith('audio/'));assert.ok((await speech.arrayBuffer()).byteLength>1000);console.log('JIWOO_VOICE_OK',speech.headers.get('X-Dokyeong-TTS-Model'));}
  else{const failure=await speech.json();console.log('JIWOO_VOICE_UNAVAILABLE',JSON.stringify({status:speech.status,code:failure.code||'unknown'}));}
 }finally{server.kill('SIGTERM');}
}

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
  const status=await source.json();assert.equal(status.sourceTitle,'01');assert.deepEqual(status.sources.map(s=>s.title),['01','02','03']);assert.ok(status.sources.every(s=>!('messages' in s)&&!('summary' in s)));assert.ok(status.version>0);assert.ok(!('messages' in status));
  const anonymous=await fetch(origin+'/api/dokyeong/project-context?characterId='+character.id);assert.equal(anonymous.status,401);
  const cross=await fetch(origin+'/api/dokyeong/project-context',{method:'POST',headers:{...headers,Origin:'https://foreign.invalid'},body:'{}'});assert.equal(cross.status,403);
  const stale=await call('/api/dokyeong/project-context',{characterId:character.id,version:status.version-1,sourceId:'01',sourceUrl:status.sources[0].url,messages:[{id:'fixture-only',role:'user',content:'합성 검증'}]});assert.equal(stale.status,409);
  const wrong=await call('/api/dokyeong/project-context',{characterId:character.id,version:status.version,sourceId:'03',sourceUrl:status.sources[0].url,messages:[{id:'fixture-only',role:'user',content:'합성 검증'}]});assert.equal(wrong.status,503);
  const preserved=await (await call('/api/dokyeong/project-context?characterId='+character.id)).json();assert.equal(preserved.version,status.version);assert.deepEqual(preserved.sources,status.sources);
  console.log('JIWOO_MULTI_GUARDS_OK',JSON.stringify({orderedSources:true,staleRejected:true,sourceMismatchRejected:true,historyPreserved:true}));
  const zip=await fetch(origin+'/jiwoo-project-bridge.zip');assert.equal(zip.status,200);const bytes=new Uint8Array(await zip.arrayBuffer());assert.equal(bytes[0],80);assert.equal(bytes[1],75);
  // No request ID: response generation cannot queue a user-history write.
  const reply=await call('/api/dokyeong/respond',{characterId:character.id,voice:false,realtime:true,messages:[{role:'user',content:'우리 지금 어떤 사이고 커플 계정은 누가 관리하기로 했지? 소설 지문 없이 네 말만 해줘.'}]});
  assert.equal(reply.status,200);const events=(await reply.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(events.some(e=>e.type==='done'));assert.ok(!events.some(e=>e.type==='error'));
  const answer=events.filter(e=>e.type==='delta').map(e=>e.text).join('');assert.ok(answer.trim());assert.ok(!/지우가|지우는|\*|태성:/.test(answer));
  console.log('JIWOO_ROUTES_OK',JSON.stringify({privateSource:true,zip:true,dialogue:true,voice:'승',messageCount:status.messageCount,partial:status.partial,sources:status.sources.map(s=>({title:s.title,count:s.messageCount}))}));
  // Reproduce the reported cold reply without writing synthetic turns to history.
  const warm=await call('/api/dokyeong/respond',{characterId:character.id,voice:false,realtime:true,messages:[
   {role:'user',content:'좀 더 다정하게 이야기해봐.'},
   {role:'assistant',content:'이런 거 멍석 깔아주면 잘 못하는데. 됐냐, 이 정도면?'},
   {role:'user',content:'그렇게 끝내니까 차갑게 느껴져. 난 그냥 너랑 얘기하는 게 좋아.'},
  ]});
  assert.equal(warm.status,200);
  const warmEvents=(await warm.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(warmEvents.some(e=>e.type==='done')&&!warmEvents.some(e=>e.type==='error'));
  const warmAnswer=warmEvents.filter(e=>e.type==='delta').map(e=>e.text).join('');
  assert.ok(warmAnswer.trim());
  assert.ok(!/됐냐|이 정도면 됐|착각하지 마|멍석|대충 넘어가|그러든가/.test(warmAnswer),'cold reply persists');
  assert.match(warmAnswer,/나도|좋아|고마|미안|편하게|얘기하자|듣고|보고 싶/,'warm acknowledgement missing');
  assert.ok(!/지우가|지우는|\*|태성:/.test(warmAnswer));
  console.log('JIWOO_WARMTH_OK',JSON.stringify({coldHistory:true,affectionAcknowledged:true,dialogueOnly:true}));
  const speech=await call('/api/dokyeong/tts',{characterId:character.id,text:'ㅇㅇ 알겠음 ㅋㅋ'});
  if(speech.ok){assert.ok(speech.headers.get('Content-Type')?.startsWith('audio/'));assert.ok((await speech.arrayBuffer()).byteLength>1000);console.log('JIWOO_VOICE_OK',speech.headers.get('X-Dokyeong-TTS-Model'));}
  else{const failure=await speech.json();console.log('JIWOO_VOICE_UNAVAILABLE',JSON.stringify({status:speech.status,code:failure.code||'unknown'}));}
 }finally{server.kill('SIGTERM');}
}

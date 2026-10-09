import {createHmac} from 'node:crypto';import {spawn} from 'node:child_process';
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-live-hardening]')){
 const origin='http://127.0.0.1:3198';const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();if(!secret)throw Error('Verification credentials unavailable');
 const expiry=String(Date.now()+600000);const headers={Origin:origin,Cookie:`dokyeong_live_session=${expiry}.${createHmac('sha256',secret).update(expiry).digest('hex')}`,'Content-Type':'application/json'};
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3198','-H','127.0.0.1'],{stdio:'ignore'});
 const call=(path,options={})=>fetch(origin+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(25000)});
 try{
  for(let i=0;i<40;i++){try{await call('/api/dokyeong/status');break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const chars=await (await call('/api/dokyeong/characters')).json();const c=chars.characters?.[0];if(!c)throw Error('Characters missing');
  const first=await call('/api/dokyeong/history');if(!first.ok)throw Error('History read failed '+first.status);const tag=first.headers.get('etag');const histories=await first.json();
  if(!tag||(await call('/api/dokyeong/history',{headers:{'If-None-Match':tag}})).status!==304)throw Error('History conditional read failed');
  if(JSON.stringify(histories).includes('data:image/'))throw Error('History still contains inline photos');
  const image=histories.flatMap(h=>h.messages).find(m=>m.image)?.image;if(image){const r=await call(image.dataUrl);const bytes=await r.arrayBuffer();if(!r.ok||!r.headers.get('Content-Type')?.startsWith('image/')||bytes.byteLength<1000)throw Error('Private media retrieval failed');}
  const settings=await (await call('/api/dokyeong/data',{method:'POST',body:JSON.stringify({action:'settings'})})).json();if(!settings.version||!settings.image_daily_limit||!settings.character_daily_cap)throw Error('Preferences missing');
  for(const action of ['memory','archive','search']){const r=await call('/api/dokyeong/data',{method:'POST',body:JSON.stringify({action,characterId:c.id,data:{query:'오늘'}})});if(!r.ok)throw Error('Data operation failed '+action+' '+r.status);}
  const jobs=await call('/api/dokyeong/images?characterId='+c.id);if(!jobs.ok||!Array.isArray(await jobs.json()))throw Error('Job list failed');
  const anonymous=await fetch(origin+'/api/dokyeong/history');if(anonymous.status!==401)throw Error('Private history authentication failed');
  const invalidWorker=await fetch(origin+'/api/dokyeong/worker',{method:'POST',headers:{Authorization:'Bearer '+ 'é'.repeat((process.env.LIVE_WORKER_SECRET||'').length)}});if(invalidWorker.status!==401)throw Error('Malformed worker header failed');
  const manifest=await (await fetch(origin+'/dokyeong-live.webmanifest')).json();if(manifest.name!=='kakao'||manifest.icons.some(i=>!i.src.startsWith('/live-chat-icon-')))throw Error('Brand assets missing');
  console.log('LIVE_HARDENING_ROUTES_OK: private media, history ETag/304, memory/search/preferences, image jobs, auth boundaries, LIVE manifest');
 }finally{server.kill('SIGTERM');}
}

import {execFileSync,spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
execFileSync(process.execPath,['--test','tests/message-session.test.mjs'],{stdio:'inherit'});
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-message-session]')){
 const dir=resolve('node_modules/.cache/message-session-verify');mkdirSync(dir,{recursive:true});
 try{
  for(const name of ['character','config','gemini-json','message-session']){
   const source=readFileSync(`lib/dokyeong/${name}.ts`,'utf8');
   const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from (["'])\.\/([^"']+)\1/g,(_,quote,file)=>`from ${quote}./${file}.mjs${quote}`);
   writeFileSync(`${dir}/${name}.mjs`,compiled);
  }
  const {geminiJson}=await import(pathToFileURL(`${dir}/gemini-json.mjs`).href);
  const {shortMessagePrompt,shortMessageSchema,parseShortMessage}=await import(pathToFileURL(`${dir}/message-session.mjs`).href);
  const prompt=shortMessagePrompt({characterPrompt:'친근한 성인 캐릭터. 상대를 형이라고 부르는 반말.',time:'한국 시간 오후 4시',routine:'',situation:'',memory:'형의 강아지 이름은 모모.',sent:4,total:30,context:'사용자: 강아지랑 산책 중이야.\n캐릭터: 모모도 신났겠네.\n사용자: 모모 아니라 코코야. 이름을 코코로 정정해서 짧게 말해 줘.'});
  const text=parseShortMessage(await geminiJson(prompt,shortMessageSchema));
  if(!text.includes('코코')||text.includes('모모'))throw Error('Latest correction was not reflected');
  console.log('LIVE_MESSAGE_SESSION_MODEL_OK',JSON.stringify({short:true,latestCorrection:true}));
  // Exercise the built app's authentication, validation and stored status without
  // starting a real session or putting messages/notifications into user chats.
  const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();
  if(!secret)throw Error('Session API verification credentials unavailable');
  const origin='http://127.0.0.1:3137';
  const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3137'],{stdio:'ignore'});
  try{
   let ready=false;
   for(let i=0;i<40;i++){
    if(app.exitCode!==null)throw Error('Session API verification server exited');
    try{const response=await fetch(origin+'/api/dokyeong/status',{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   if(!ready)throw Error('Session API verification server unavailable');
   const expiry=String(Date.now()+120000);
   const cookie=`dokyeong_live_session=${expiry}.${createHmac('sha256',secret).update(expiry).digest('hex')}`;
   const call=async(body,authenticated=true,requestOrigin=origin)=>fetch(origin+'/api/dokyeong/companion',{method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin,...(authenticated?{Cookie:cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   const base={deviceId:randomUUID(),characterId:randomUUID(),action:'session_start',data:{sessionId:randomUUID(),minutes:30,count:30}};
   if((await call(base,false)).status!==401)throw Error('Session route accepted unauthenticated request');
   if((await call(base,true,'https://example.invalid')).status!==403)throw Error('Session route accepted cross-origin request');
   if((await call({...base,data:{...base.data,count:121}})).status!==400)throw Error('Session route accepted invalid quota');
   if((await call({...base,data:{...base.data,sessionId:'invalid'}})).status!==400)throw Error('Session route accepted invalid session id');
   const status=await call({deviceId:base.deviceId,action:'status'});
   if(!status.ok)throw Error('Session status RPC unavailable');
   const state=await status.json();
   const characters=Object.values(state.characters||{});
   if(!characters.length||characters.some(c=>!Object.hasOwn(c,'session')))throw Error('Stored session status missing');
   if((await fetch(origin+'/api/dokyeong/session-worker',{method:'POST'})).status!==401)throw Error('Session worker accepted unauthenticated request');
   console.log('LIVE_MESSAGE_SESSION_API_OK',JSON.stringify({auth:true,origin:true,validation:true,storedStatus:true,workerAuth:true}));
  }finally{app.kill('SIGTERM');}
 }finally{rmSync(dir,{recursive:true,force:true});}
}

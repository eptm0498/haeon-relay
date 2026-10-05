import {mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import ts from 'typescript';import assert from 'node:assert/strict';
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-reply-timing]')){
 const dir=resolve('node_modules/.cache/reply-timing-verify');mkdirSync(dir,{recursive:true});
 for(const file of readdirSync('lib/dokyeong').filter(n=>n.endsWith('.ts'))){let compiled=ts.transpileModule(readFileSync('lib/dokyeong/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;compiled=compiled.replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name}.mjs${q}`);writeFileSync(`${dir}/${file.replace(/\.ts$/,'.mjs')}`,compiled);}
 const local=async name=>import(pathToFileURL(`${dir}/${name}.mjs`).href);
 try{
  const {serverRpc}=await local('memory');const {prepareReply}=await local('reply-jobs');const {geminiJson}=await local('gemini-json');const {timingPrompt}=await local('reply-timing');
  const originalFetch=globalThis.fetch;let scheduled;let scene='';let photoMode=false;
  globalThis.fetch=async(url,options)=>{
   const path=String(url);if(!path.includes('/rpc/'))return originalFetch(url,options);
   const request=JSON.parse(options.body);let value=null;
   if(path.endsWith('/live_reply_work')){
    if(request.action==='claim')value={id:'fixture',character_id:'fixture',epoch:'fixture',kind:'reply',lease:'fixture',payload:{},context:{messages:[{id:'fixture',role:'user',ts:Date.now(),content:photoMode?'응 그 옷 입고 보여줘':'20분 정도 씻고 와. 다 씻으면 연락해.'},...(photoMode?[]:[])],memory:''},activity:{}};
    if(photoMode&&request.action==='claim')value.context.messages=[{role:'assistant',ts:Date.now()-3000,content:'흰 티셔츠 입고 카페 창가에서 셀카 찍어서 보내줄까?'},{role:'user',ts:Date.now(),content:'응 그 옷 입고 보여줘'}];
    if(request.action==='schedule'){scheduled=request.data;scene=request.data.photo?.scene||'';value={dueAt:new Date().toISOString()};}
    if(request.action==='fail')throw Error('Timing provider fixture failed');
   }else if(path.endsWith('/live_server_character'))value={id:'fixture',name:'온유',prompt:'온유 캐릭터. 상대 도혁은 기존 재경 세계관 인물의 이름만 도혁이다. 온유는 형, 도혁은 동생. 반말로 도혁아라고 부른다. 실제 사용자와 분리한다.',voice_id:'fixture'};
   else if(path.includes('sample'))value=[];
   return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  };
  try{
   await prepareReply('fixture');assert.ok(scheduled);assert.match(scheduled.text,/씻|샤워/);assert.equal(scheduled.awaySeconds,1200);assert.ok(scheduled.delaySeconds>=5);console.log('LIVE_REALISTIC_ACTIVITY_PROVIDER_OK');
   photoMode=true;scheduled=null;await prepareReply('fixture');assert.ok(scheduled?.photo);assert.match(scene,/카페|cafe|café/i);assert.match(scene,/티셔츠|t-shirt|t shirt/i);console.log('LIVE_DELAYED_CONTEXTUAL_PHOTO_OK');
  }finally{globalThis.fetch=originalFetch;}
  const characters=await serverRpc('live_server_characters',{});const onyu=characters.find(c=>c.name==='온유');assert.ok(onyu);
  const persona=await serverRpc('live_server_character',{character_id:onyu.id});assert.match(persona.prompt,/기존 재경 세계관/);assert.ok(!persona.prompt.includes('사용자는 이도혁이며'));
  const result=await geminiJson(persona.prompt+timingPrompt+'\n사용자: 형, 나랑 어떤 사이고 날 뭐라고 불러? 한두 문장으로 답해.',{type:'OBJECT',properties:{text:{type:'STRING'}},required:['text']});assert.match(result.text,/도혁/);assert.ok(!/현우|후원|80만원/.test(result.text));console.log('LIVE_ONYU_FICTIONAL_PERSONA_OK');
 }finally{rmSync(dir,{recursive:true,force:true});}
}

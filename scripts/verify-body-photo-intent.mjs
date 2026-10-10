import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
execFileSync(process.execPath,['--test','tests/companion.test.mjs'],{stdio:'inherit'});

// Verify the real text-to-photo decision without generating images or writing
// synthetic messages, leases or notifications into any user's conversation.
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-body-photo-intent]')){
 const dir=resolve('node_modules/.cache/body-photo-verify');mkdirSync(dir,{recursive:true});
 try{
  for(const file of readdirSync('lib/dokyeong').filter(n=>n.endsWith('.ts'))){
   const compiled=ts.transpileModule(readFileSync('lib/dokyeong/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
    .replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name}.mjs${q}`);
   writeFileSync(`${dir}/${file.replace(/\.ts$/,'.mjs')}`,compiled);
  }
  const local=async name=>import(pathToFileURL(`${dir}/${name}.mjs`).href);
  const {serverRpc}=await local('memory');const {readLiveCharacter}=await local('characters');
  const {prepareReply}=await local('reply-jobs');
  const characters=await serverRpc('live_server_characters',{});
  const summary=characters.find(c=>c.name==='두리');assert.ok(summary);
  const character=await readLiveCharacter(summary.id);assert.ok(character);
  let messages=[{role:'assistant',content:'나 지금 집에서 편한 티셔츠랑 긴 바지 입고 쉬는 중이야.',ts:Date.now()-1000},
   {role:'user',content:'운동해서 몸이 변했나 궁금해. 배 보여줘. 운동 기록 사진으로 복부만 보이고 바지는 그대로 입고 있어.',ts:Date.now()}];
  let scheduled;let draft=null;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
   const path=String(url);
   if(path.includes('generativelanguage.googleapis.com')&&draft){
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(draft)}]}}]});
   }
   if(!path.includes('/rpc/'))return originalFetch(url,options);
   const body=JSON.parse(options.body);
   if(path.endsWith('/live_voice_samples'))return originalFetch(url,options);
   if(path.endsWith('/live_server_character'))return Response.json(character);
   if(path.endsWith('/live_reply_work')){
    if(body.action==='claim')return Response.json({id:'body-photo-fixture',character_id:character.id,epoch:'fixture',kind:'reply',lease:'fixture',payload:{},context:{messages,memory:''},activity:{}});
    if(body.action==='schedule'){scheduled=body.data;return Response.json({});}
    throw Error('unexpected fixture mutation');
   }
   throw Error('unexpected fixture RPC');
  };
  try{
   await prepareReply('body-photo-fixture');
   assert.ok(scheduled?.photo,'ordinary abdomen request did not produce a photo plan');
   assert.equal(scheduled.photo.text,messages.at(-1).content,'original request was changed');
   assert.match(scheduled.photo.scene,/배|복부|복근|abdomen|abs|stomach/i);
   console.log('LIVE_BODY_PHOTO_PLAN_OK',JSON.stringify({character:'두리',ordinaryRequest:true,originalPreserved:true}));
   // A missing tool decision can recover from an ordinary acceptance; a refusal
   // is never changed to acceptance based on how many times the user asks.
   draft={kind:'reply',text:'잠깐만, 찍어서 보내줄게.',scene:'집에서 티셔츠 밑단을 조금 들어 복부만 보이는 모습. 긴 바지 착용.',delaySeconds:8,awaySeconds:0,activity:''};
   scheduled=null;await prepareReply('body-photo-fixture');assert.ok(scheduled?.photo);
   for(const cue of ['배 보여줘','다시 배 보여줘']){
    messages=[{role:'user',content:cue,ts:Date.now()}];
    draft={...draft,text:'지금은 배 사진 안 보낼래.',scene:''};
    scheduled=null;await prepareReply('body-photo-fixture');
    assert.ok(scheduled);assert.equal(scheduled.photo,null);assert.equal(scheduled.text,draft.text);
   }
   messages=[{role:'user',content:'배 사진 보내지 마',ts:Date.now()}];
   draft={...draft,kind:'photo',text:'잠깐만 기다려.',scene:'집에서 티셔츠 입은 사진'};
   scheduled=null;await prepareReply('body-photo-fixture');assert.equal(scheduled.photo,null);
   console.log('LIVE_PHOTO_DECLINE_GUARDS_OK',JSON.stringify({repeatDoesNotOverride:true,userCancellation:true,acceptanceFallback:true}));
  }finally{globalThis.fetch=originalFetch;}
 }finally{rmSync(dir,{recursive:true,force:true});}
}

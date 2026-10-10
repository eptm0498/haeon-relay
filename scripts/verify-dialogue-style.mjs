import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
execFileSync(process.execPath,['--test','tests/dialogue-style.test.mjs'],{stdio:'inherit'});

// Use production credentials only inside the reviewed build. RPC mutations are
// intercepted: these synthetic conversations never enter user history or push.
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-dialogue-style]')){
 const dir=resolve('node_modules/.cache/dialogue-style-verify');mkdirSync(dir,{recursive:true});
 try{
  for(const file of readdirSync('lib/dokyeong').filter(n=>n.endsWith('.ts'))){
   const compiled=ts.transpileModule(readFileSync('lib/dokyeong/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
    .replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name}.mjs${q}`);
   writeFileSync(`${dir}/${file.replace(/\.ts$/,'.mjs')}`,compiled);
  }
  const local=async name=>import(pathToFileURL(`${dir}/${name}.mjs`).href);
  const {serverRpc}=await local('memory');
  const {readLiveCharacter}=await local('characters');
  const {prepareReply}=await local('reply-jobs');
  const {relatedSampleContext}=await local('samples');
  const {shortMessagePrompt,shortMessageSchema,parseShortMessage}=await local('message-session');
  const {geminiJson}=await local('gemini-json');
  const all=await serverRpc('live_server_characters',{});
  for(const name of ['온유','도경','두리']){
   const summary=all.find(c=>c.name===name);assert.ok(summary,'character unavailable');
   const character=await readLiveCharacter(summary.id);assert.ok(character);
   const tic=name==='두리'?'왐마':name==='도경'?'바부탱':'기지기지';
   const messages=Array.from({length:3},(_,i)=>({role:'assistant',content:`${tic} ㅋㅋㅋㅋ 오늘 뭐해?`,ts:Date.now()-60000*(3-i)}));
   let scheduled;let archiveReads=0;
   const originalFetch=globalThis.fetch;
   globalThis.fetch=async(url,options)=>{
    const path=String(url);
    if(!path.includes('/rpc/'))return originalFetch(url,options);
    const body=JSON.parse(options.body);
    if(path.endsWith('/live_voice_samples')){
     assert.equal(body.target_character,character.id);
     const result=await originalFetch(url,options);assert.ok(result.ok);
     const pool=await result.clone().json();assert.ok(pool.length>=5);archiveReads++;
     return result;
    }
    if(path.endsWith('/live_server_character'))return Response.json(character);
    if(path.endsWith('/live_reply_work')){
     if(body.action==='claim')return Response.json({id:'voice-fixture',character_id:character.id,epoch:'fixture',kind:'reply',lease:'fixture',payload:{},context:{messages,memory:''},activity:{}});
     if(body.action==='schedule'){scheduled=body.data;return Response.json({});}
     throw Error('unexpected fixture mutation: '+body.action);
    }
    throw Error('unexpected fixture RPC');
   };
   try{
    for(const cue of [
     '점심은 라면 말고 김밥 먹었어. 내가 먹은 음식 이름을 넣어서 짧게 반응해줘.',
     '그리고 오늘 아무것도 하기 싫어. 매번 밥이나 잠 얘기 말고 그냥 내 얘기 좀 들어줘.',
    ]){
     messages.push({role:'user',content:cue,ts:Date.now()});scheduled=null;
     await prepareReply('voice-fixture');assert.ok(scheduled?.text);
     assert.ok(!scheduled.photo);assert.ok(scheduled.text.length<=500);
     assert.ok(!/재경|현우/.test(scheduled.text),'outdated addressee');
     assert.ok(!messages.some(m=>m.role==='assistant'&&m.content===scheduled.text),'identical repeated reply');
     if(cue.includes('김밥'))assert.ok(scheduled.text.includes('김밥'),'latest meal correction missing');
     messages.push({role:'assistant',content:scheduled.text,ts:Date.now()});
    }
    const chat=await relatedSampleContext(messages,character.id,name,'chat');
    const voice=await relatedSampleContext(messages,character.id,name,'voice');
    assert.ok(chat.includes('사례 5'));assert.ok(voice.includes('이번 답변은 통화용 입말'));
    const short=parseShortMessage(await geminiJson(shortMessagePrompt({characterPrompt:character.prompt+chat,time:'한국 시간 오후',context:'사용자: 강아지 이름을 모모가 아니라 코코로 정정해 줘. 다음 짧은 톡에는 코코라고 불러줘.',memory:'강아지 이름은 모모.',routine:'',situation:'',sent:2,total:30}),shortMessageSchema,undefined,undefined,{temperature:0.85}));
    assert.ok(short.includes('코코')&&!short.includes('모모'));
    assert.ok(archiveReads>=4);
    console.log('LIVE_DIALOGUE_STYLE_OK',JSON.stringify({character:name,sourceExamples:true,contextCorrection:true,distinctReplies:true,chatAndVoice:true,shortSession:true}));
   }finally{globalThis.fetch=originalFetch;}
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
}

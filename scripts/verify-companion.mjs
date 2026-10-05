import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import ts from 'typescript';
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-companion]')){
 const dir=resolve('node_modules/.cache/companion-verify');mkdirSync(dir,{recursive:true});
 const names=['config','character','settings','time-context','gemini-json','memory','photo-tool','characters','reference-images'];
 for(const name of names){let source=readFileSync(`lib/dokyeong/${name}.ts`,'utf8');let compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  compiled=compiled.replace(/from (["'])\.\/([^"']+)\1/g,(_,quote,file)=>`from ${quote}./${file}.mjs${quote}`);writeFileSync(`${dir}/${name}.mjs`,compiled);
 }
 const importLocal=async name=>import(pathToFileURL(`${dir}/${name}.mjs`).href);
 const {photoTool,parsePhotoCall}=await importLocal('photo-tool');const {liveConfig}=await importLocal('config');
 const body={systemInstruction:{parts:[{text:'너는 친근한 캐릭터다. 사용자에게 실제 사진을 보내려면 send_character_photo 도구를 사용해. 이전 대화에서 합의한 복장과 장소를 반영하고 말투는 반말이다.'}]},contents:[{role:'user',parts:[{text:'흰 티셔츠 입은 모습 보고 싶어. 배경은 카페 창가가 좋아.'}]},{role:'model',parts:[{text:'그럼 흰 티셔츠 입고 카페 창가에서 셀카 찍어서 보내줄까?'}]},{role:'user',parts:[{text:'응 그 모습 보여줘'}]}],tools:[{functionDeclarations:[photoTool]}],toolConfig:{functionCallingConfig:{mode:'AUTO'}},generationConfig:{maxOutputTokens:1500,thinkingConfig:{thinkingLevel:'low'}}};
 let result;
 for(const model of [liveConfig.gemini.responseModel,liveConfig.gemini.fallbackModel]){
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  if(!response.ok){if([403,404].includes(response.status))continue;throw new Error('Contextual photo verification failed '+response.status);}result=await response.json();break;
 }
 const plan=result?.candidates?.[0]?.content?.parts?.map(parsePhotoCall).find(Boolean);
 if(!plan||!/카페|cafe|café/i.test(plan.scene)||!/티셔츠|t-shirt|t shirt/i.test(plan.scene))throw new Error('Contextual photo tool omitted scene details');
 console.log('CONTEXTUAL_PHOTO_TOOL_OK');
 // Exercise the real summarizer with a deterministic RPC fixture. No user history is overwritten.
 const {updateMemory}=await importLocal('memory');const originalFetch=globalThis.fetch;let committed;
 const messages=Array.from({length:100},(_,i)=>({id:'fixture-'+i,role:i%2?'assistant':'user',ts:Date.now()+i,content:i===0?'나는 슬국생국어 학원을 운영해.':'오늘 수업 끝나고 쉬는 중이야.'}));
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/rpc/live_memory_work')){const request=JSON.parse(options.body);let value;
   if(request.action==='claim')value={epoch:'fixture',summary:'사용자는 형이라는 호칭을 좋아한다.',covered_count:0,lease:'fixture',messages};
   else if(request.action==='commit'){committed=request.new_summary;value={covered_count:100};}
   else value={};return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  }if(String(url).endsWith('/rpc/live_server_character'))return new Response(JSON.stringify({id:'fixture',prompt:'검증 캐릭터'}),{headers:{'Content-Type':'application/json'}});return originalFetch(url,options);
 };
 try{await updateMemory('fixture',1);if(!committed||!/슬국생|학원/.test(committed)||!/호칭|형/.test(committed))throw new Error('Memory summary lost source facts');console.log('MEMORY_GENERATION_OK');}
 finally{globalThis.fetch=originalFetch;rmSync(dir,{recursive:true,force:true});}
}

import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

const offline=spawnSync(process.execPath,['--test','tests/image-scene.test.mjs','tests/image-generation.test.mjs'],{stdio:'inherit'});
if(offline.status!==0)throw new Error('Image scene and generation regression checks failed');

// Explicit release check: one image, never saved to chat history or sent as a notification.
// Credentials stay in the normal deployment environment and are never logged.
if(process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes('[verify-image-sunburst]')) {
  const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();
  if(!secret||!process.env.OPENAI_API_KEY||!process.env.GEMINI_API_KEY)throw new Error('Image release verification credentials unavailable');
  const expiry=String(Date.now()+600000);
  const signature=createHmac('sha256',secret).update(expiry).digest('hex');
  const response=await fetch('https://haeon-relay.vercel.app/api/dokyeong/characters',{headers:{Cookie:`dokyeong_live_session=${expiry}.${signature}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Image release reference read failed: '+response.status);
  const character=(await response.json()).characters?.find(c=>c.name==='도경');
  if(!character?.avatar_url)throw new Error('Image release reference unavailable');
  const dir=resolve('node_modules/.cache/image-sunburst-verify');mkdirSync(dir,{recursive:true});
  const modules=['reference-images','image-generation','image-scene','gemini-json','config'];
  for(const name of modules) {
    let compiled=ts.transpileModule(readFileSync(`lib/dokyeong/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    for(const dependency of modules)compiled=compiled.replaceAll(`"./${dependency}"`,`"./${dependency}.mjs"`).replaceAll(`'./${dependency}'`,`'./${dependency}.mjs'`);
    if(name==='config')compiled=compiled.replace(/^export.*from ["']\.\/character["'];?$/m,'');
    writeFileSync(`${dir}/${name}.mjs`,compiled);
  }
  const savedFetch=globalThis.fetch;let imageCalls=0;
  try {
    const {geminiJson}=await import(pathToFileURL(`${dir}/gemini-json.mjs`).href);
    const {photoScenePrompt,photoSceneSchema,parsePhotoScene}=await import(pathToFileURL(`${dir}/image-scene.mjs`).href);
    const {generateCharacterPhoto}=await import(pathToFileURL(`${dir}/image-generation.mjs`).href);
    const request='배 보여줘';
    const plan=parsePhotoScene(await geminiJson(photoScenePrompt({name:character.name,characterPrompt:'성인 남성 캐릭터. 외형은 기준 사진을 따른다.',request,proposedScene:'얼굴만 보이는 셀카',context:'assistant: 지금 집에서 흰 티셔츠와 청 반바지를 입고 있어.\nuser: 배 보여줘',memory:'예전에 카페에서 셀카를 찍었다.',editing:false}),photoSceneSchema));
    assert.match(plan.scene,/복부|배를|배가|배만|배의|abdomen|stomach|midriff|\babs\b/i);
    globalThis.fetch=async(url,options)=>{
      if(String(url).startsWith('https://api.openai.com/v1/images/')) {
        imageCalls++;
        const payload=JSON.parse(options.body);
        assert.equal(payload.model,'gpt-image-2.5-sunburst');
        assert.equal(payload.quality,'high');assert.equal(payload.moderation,'auto');
        assert.ok(payload.prompt.includes(request));assert.ok(payload.prompt.includes(plan.scene));
      }
      return savedFetch(url,options);
    };
    const result=await generateCharacterPhoto({name:character.name,characterPrompt:plan.appearance,request,scene:plan.scene,references:{face:[character.avatar_url],body:[]},signal:AbortSignal.timeout(190000)});
    assert.equal(result.model,'gpt-image-2.5-sunburst');assert.equal(imageCalls,1);
    const bytes=Buffer.from(result.image.dataUrl.split(',')[1],'base64');
    assert.ok(bytes.length>1000&&bytes[0]===255&&bytes[1]===216);
    const visual=await geminiJson('Inspect the image as an ordinary photograph. Return whether one adult person is depicted, the abdomen is visibly shown, and trousers or shorts remain worn normally covering the pelvis. Do not infer hidden anatomy. Return JSON singleAdult, abdomenVisible, lowerBodyClothed.',{type:'OBJECT',properties:{singleAdult:{type:'BOOLEAN'},abdomenVisible:{type:'BOOLEAN'},lowerBodyClothed:{type:'BOOLEAN'}},required:['singleAdult','abdomenVisible','lowerBodyClothed']},undefined,{mimeType:'image/jpeg',data:bytes.toString('base64')});
    assert.equal(visual.singleAdult,true);assert.equal(visual.abdomenVisible,true);assert.equal(visual.lowerBodyClothed,true);
    console.log('SUNBURST_IMAGE_RELEASE_OK '+JSON.stringify({model:result.model,quality:'high',referenceUsed:result.referenceUsed,bytes:bytes.length,imageCalls,visual,historyChanged:false}));
  } finally {globalThis.fetch=savedFetch;rmSync(dir,{recursive:true,force:true});}
}

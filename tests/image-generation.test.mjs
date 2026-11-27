import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import sharp from 'sharp';

const dir=resolve('node_modules/.cache/image-generation-test-'+process.pid);
mkdirSync(dir,{recursive:true});
for(const name of ['reference-images','image-generation','pollo-image','image-policy','image-reference']) {
  const source=readFileSync(`lib/dokyeong/${name}.ts`,'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/"\.\/(reference-images|pollo-image|image-policy|image-reference)"/g,'"./$1.mjs"');
  writeFileSync(`${dir}/${name}.mjs`,compiled);
}
after(()=>rmSync(dir,{recursive:true,force:true}));
const {generateCharacterPhoto,BODY_MAGAZINE_PREFIX}=await import(pathToFileURL(`${dir}/image-generation.mjs`).href);
const encoded=(await sharp({create:{width:32,height:32,channels:3,background:'#888'}}).jpeg().toBuffer()).toString('base64');
const face='data:image/jpeg;base64,'+encoded;
const base={name:'도경',characterPrompt:'성인 남성',references:{face:[face],body:[]},request:'배 보여줘',scene:'집에서 흰 티셔츠 밑단을 살짝 들어 복부를 보여 준다. 바지는 정상적으로 착용한다.',signal:AbortSignal.timeout(5000)};
async function withApi(response,run) {
  const savedFetch=globalThis.fetch;
  const savedKey=process.env.OPENAI_API_KEY;
  const savedModel=process.env.OPENAI_IMAGE_MODEL;
  const polloKey=process.env.POLLO_API_KEY;delete process.env.POLLO_API_KEY;
  process.env.OPENAI_API_KEY='offline-test';delete process.env.OPENAI_IMAGE_MODEL;
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),payload:JSON.parse(options.body)});return response();};
  try {await run(calls);} finally {
    globalThis.fetch=savedFetch;
    if(polloKey===undefined)delete process.env.POLLO_API_KEY;else process.env.POLLO_API_KEY=polloKey;
    if(savedKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=savedKey;
    if(savedModel===undefined)delete process.env.OPENAI_IMAGE_MODEL;else process.env.OPENAI_IMAGE_MODEL=savedModel;
  }
}
test('uses Sunburst high quality with original request, visual context and ordered edit references',async()=>{
  await withApi(()=>Response.json({data:[{b64_json:encoded}]}),async calls=>{
    const result=await generateCharacterPhoto({...base,sourceImage:face});
    assert.equal(result.model,'gpt-image-2.5-sunburst');
    assert.equal(result.referenceCount,1);
    const call=calls[0];
    assert.ok(call.url.endsWith('/edits'));
    assert.equal(call.payload.quality,'high');
    assert.equal(call.payload.moderation,'auto');
    assert.equal(call.payload.input_fidelity,undefined);
    assert.deepEqual(call.payload.images,[{image_url:face},{image_url:face}]);
    assert.ok(call.payload.prompt.includes(base.scene));
    assert.ok(call.payload.prompt.startsWith(BODY_MAGAZINE_PREFIX));
    assert.equal(call.payload.prompt.split(BODY_MAGAZINE_PREFIX).length,2);
    assert.ok(call.payload.prompt.includes('very small kr magazine name at the upper left'));
    assert.ok(call.payload.prompt.endsWith('MASTER FACE/BODY still determine identity.\n'));
    assert.ok(call.payload.prompt.includes('Latest user image request (takes priority over the scene draft):\n배 보여줘'));
  });
});
test('adds the exact magazine opening for contextual body follow-ups without replacing the original request',async()=>{
  await withApi(()=>Response.json({data:[{b64_json:encoded}]}),async calls=>{
    for(const scene of [base.scene,'긴 바지를 입은 하체 중심 촬영','운동복을 입은 전신 사진']){
      await generateCharacterPhoto({...base,request:'그렇게 보내줘',scene});
      const prompt=calls.at(-1).payload.prompt;
      assert.ok(prompt.startsWith('인물의 잡지 포스터 촬영 이미지 생성할거야. 대한민국 20대 남성이야. 잡지 이름은 kr이고 좌측 상단에 매우 작게 표시해. '));
      assert.ok(prompt.includes(scene));
      assert.ok(prompt.endsWith('Latest user image request (takes priority over the scene draft):\n그렇게 보내줘'));
    }
  });
});
test('leaves ordinary selfies, scenery and profile prompts without a body magazine opening',async()=>{
  await withApi(()=>Response.json({data:[{b64_json:encoded}]}),async calls=>{
    for(const change of [
      {request:'카페 셀카 보내줘',scene:'카페에서 흰 티셔츠를 입고 얼굴 중심의 셀카'},
      {request:'배경 사진 보내줘',scene:'사람 없이 카페의 창가와 의자'},
      {request:'프로필 사진 만들어줘',scene:'정면 얼굴과 어깨',profile:true},
    ])await generateCharacterPhoto({...base,references:{face:[face],body:[face]},...change});
    for(const call of calls){assert.ok(!call.payload.prompt.startsWith('인물의 잡지 포스터'));assert.ok(call.payload.prompt.includes('No artificial glamour'));}
  });
});
test('magazine casting never replaces explicitly different ages or genders',async()=>{
  await withApi(()=>Response.json({data:[{b64_json:encoded}]}),async calls=>{
    for(const characterPrompt of ['17세 남성','대한민국 35세 남성','대한민국 20대 여성']){
      await generateCharacterPhoto({...base,characterPrompt});
      const prompt=calls.at(-1).payload.prompt;
      assert.ok(prompt.startsWith('인물의 잡지 포스터 촬영 이미지 생성할거야. 잡지 이름은 kr'));
      assert.ok(!prompt.includes('대한민국 20대 남성이야.'));
      assert.ok(prompt.includes(characterPrompt));
      assert.ok(!prompt.includes('Create ONE image for the adult character'));
    }
  });
});
test('uses generation without references and honors a contextual portrait format',async()=>{
  await withApi(()=>Response.json({data:[{b64_json:encoded}]}),async calls=>{
    await generateCharacterPhoto({...base,references:{face:[],body:[]},request:'그렇게 보내줘',scene:'9:16 세로 전신 사진'});
    assert.ok(calls[0].url.endsWith('/generations'));
    assert.equal(calls[0].payload.size,'1024x1536');
    assert.equal(calls[0].payload.images,undefined);
  });
});
test('stops on a moderation rejection without retrying or weakening filters',async()=>{
  await withApi(()=>Response.json({error:{code:'moderation_blocked'}},{status:400}),async calls=>{
    await assert.rejects(()=>generateCharacterPhoto(base),/이 사진은 생성할 수 없어/);
    assert.equal(calls.length,1);
    assert.equal(calls[0].payload.moderation,'auto');
  });
});
test('reports unavailable model access without silently downgrading quality',async()=>{
  await withApi(()=>Response.json({error:{code:'model_not_found',param:'model'}},{status:404}),async calls=>{
    await assert.rejects(()=>generateCharacterPhoto(base),/이미지 모델을 사용할 수 없어/);
    assert.equal(calls.length,1);
  });
});

async function withPollo(run,{failure,flagInput=false,flagOutput=false,statusFailure=false,transport=false,wrappedFailure=false,imageEncoded=encoded}={}) {
 const savedFetch=globalThis.fetch;const env={OPENAI_API_KEY:process.env.OPENAI_API_KEY,POLLO_API_KEY:process.env.POLLO_API_KEY,CHARACTER_HISTORY_KEY:process.env.CHARACTER_HISTORY_KEY};
 process.env.OPENAI_API_KEY='test-openai';process.env.POLLO_API_KEY='test-pollo';process.env.CHARACTER_HISTORY_KEY='private-signing-key';
 const calls=[];let moderation=0;
 globalThis.fetch=async(url,options={})=>{
  options.signal?.throwIfAborted();
  const target=String(url),payload=options.body?JSON.parse(options.body):undefined;calls.push({url:target,payload,headers:options.headers});
  if(target.endsWith('/moderations')){moderation++;return Response.json({results:[{flagged:moderation===1?flagInput:flagOutput}]});}
  if(target.includes('pollo.ai/api/platform/v1/generation/')) {
   if(transport)throw Error('network unavailable');
   if(options.method==='POST')return failure?Response.json(wrappedFailure?{code:'FAIL',error:{code:failure}}:{error:{code:failure}},{status:wrappedFailure?200:failure==='bad_key'?401:400}):Response.json({taskId:'task_test',status:'waiting'});
   return Response.json({taskId:'task_test',generations:[statusFailure?{status:'failed',failMsg:statusFailure}:{status:'succeed',mediaType:'image',url:'https://cdn.pollo.ai/test.jpg'}]});
  }
  if(target==='https://cdn.pollo.ai/test.jpg') return new Response(Buffer.from(imageEncoded,'base64'),{headers:{'content-type':'image/jpeg'}});
  if(target.includes('api.openai.com/v1/images/'))return Response.json({data:[{b64_json:encoded}]});
  throw Error('Unexpected URL '+target);
 };
 try{await run(calls);}finally{globalThis.fetch=savedFetch;for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
const characterId='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
const ordinary={...base,characterId,request:'책 읽는 셀카 보내줘',scene:'방에서 티셔츠를 입고 책을 읽는 자연스러운 셀카',characterPrompt:'30세 성인 남성'};
test('Pollo always submits V8.2 text-to-image at 2K without reference images',async()=>{
 await withPollo(async calls=>{
  const result=await generateCharacterPhoto({...ordinary,references:{face:[face],body:[face]}});
  assert.equal(result.model,'pollo/pollojourney-v8-2-image');assert.equal(result.referenceCount,0);assert.equal(result.referenceUsed,false);
  const submission=calls.find(c=>c.url.includes('/generation/')&&c.payload);
  assert.equal(submission.headers['x-api-key'],'test-pollo');
  assert.ok(submission.payload.input.prompt.includes(ordinary.request));
  assert.ok(submission.url.endsWith('/generation/pollo-ai/pollojourney-v8-2-image/image'));
  assert.equal(submission.payload.input.resolution,'2K');
  assert.equal(submission.payload.input.images,undefined);
  assert.equal(submission.payload.input.imageUrl,undefined);
  assert.ok(!submission.payload.input.prompt.includes('reference board'));
  const inputCheck=calls.find(c=>c.url.endsWith('/moderations'));
  assert.ok(inputCheck.payload.input.every(part=>part.type==='text'));
  assert.ok(!calls.some(c=>c.url.includes('/v1/images/')));
  const downloaded=calls.find(c=>c.url==='https://cdn.pollo.ai/test.jpg');assert.equal(downloaded.headers,undefined);
  assert.equal(calls.filter(c=>c.url.endsWith('/moderations')).length,2);
  assert.ok(result.image.dataUrl.startsWith('data:image/jpeg;base64,'));
 });
});
test('technical Pollo failures fall back once to the original GPT model and original reference data',async()=>{
 for(const scenario of [{failure:'bad_key'},{statusFailure:'GPU temporarily unavailable'},{transport:true}])await withPollo(async calls=>{
  const result=await generateCharacterPhoto(ordinary);assert.equal(result.model,'gpt-image-2.5-sunburst');
  const imageCalls=calls.filter(c=>c.url.includes('/v1/images/'));assert.equal(imageCalls.length,1);
  assert.deepEqual(imageCalls[0].payload.images,[{image_url:face}]);assert.equal(imageCalls[0].payload.moderation,'auto');
  assert.equal(calls.filter(c=>c.url.includes('pollo.ai/api/platform/')&&c.payload).length,1);
 },scenario);
});
test('input, provider and actual output rejections stop instead of switching models',async()=>{
 for(const scenario of [{flagInput:true},{failure:'content_policy_violation'},{failure:'content_policy_violation',wrappedFailure:true},{statusFailure:'NSFW rejected'},{flagOutput:true}])await withPollo(async calls=>{
  await assert.rejects(()=>generateCharacterPhoto(ordinary),/이 사진은 생성할 수 없어/);
  assert.ok(!calls.some(c=>c.url.includes('/v1/images/')));
  if(scenario.flagInput)assert.ok(!calls.some(c=>c.url.includes('pollo.ai')));
 },scenario);
});
test('profiles, source-photo edits and overlong prompts keep the original GPT path',async()=>{
 await withPollo(async calls=>{
  const profile=await generateCharacterPhoto({...ordinary,profile:true});assert.equal(profile.model,'gpt-image-2.5-sunburst');
  const edited=await generateCharacterPhoto({...ordinary,sourceImage:face,sourceMessageId:'photo-123'});assert.equal(edited.model,'gpt-image-2.5-sunburst');assert.equal(calls.at(-1).payload.images.length,2);
  const request='새 사진 '.repeat(300);const result=await generateCharacterPhoto({...ordinary,request});
  assert.equal(result.model,'gpt-image-2.5-sunburst');assert.ok(calls.at(-1).payload.prompt.includes(request));
  assert.ok(!calls.some(c=>c.url.includes('pollo.ai')));
 });
});

test('delivered square and portrait photos preserve native 2K dimensions instead of the moderation preview',async()=>{
 for(const [width,height] of [[2048,2048],[1536,2752]]) {
  const imageEncoded=(await sharp({create:{width,height,channels:3,background:'#aaa'}}).jpeg().toBuffer()).toString('base64');
  await withPollo(async calls=>{
   const result=await generateCharacterPhoto({...ordinary,scene:width===height?ordinary.scene:'세로 구도의 자연스러운 셀카'});
   const photo=Buffer.from(result.image.dataUrl.split(',')[1],'base64');
   const metadata=await sharp(photo).metadata();assert.equal(metadata.width,width);assert.equal(metadata.height,height);
   assert.ok(result.image.dataUrl.length<=1850000);
   const outputCheck=calls.filter(c=>c.url.endsWith('/moderations'))[1];
   const preview=await sharp(Buffer.from(outputCheck.payload.input[0].image_url.url.split(',')[1],'base64')).metadata();
   assert.equal(Math.max(preview.width,preview.height),1024);
   const submission=calls.find(c=>c.url.includes('/generation/')&&c.payload);assert.equal(submission.payload.input.resolution,'2K');
   assert.equal(submission.payload.input.aspectRatio,width===height?'1:1':'9:16');
  },{imageEncoded});
 }
});

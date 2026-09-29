import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot,scenePrompt,makeSceneSnapshot} from '../lib/image-generation/scene.ts';
import {GeminiImageProvider,ImageBlockedError} from '../lib/image-generation/provider.ts';

test('snapshot keeps current outfit and identity instruction',()=>{
 const snapshot=parseSnapshot(JSON.stringify({characters:[{name:'도경',appearance:'검은 머리',clothing:'흰 셔츠',expression:'웃음',pose:'소파에 누움'}],location:'거실',time:'밤',lighting:'창밖 빛',camera:'아이폰',interaction:'올려다봄',mood:'친밀함'}));
 const prompt=scenePrompt(snapshot,'도경','조명을 더 어둡게');
 assert.match(prompt,/reference images define the visual identity/);
 assert.match(prompt,/흰 셔츠/);
 assert.match(prompt,/조명을 더 어둡게/);
});

test('scene analysis uses an available 3.1 model before image generation',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';let requested='';
 globalThis.fetch=async url=>{requested=String(url);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({characters:[{name:'지우',appearance:'검은 머리'}],location:'거실'})}]}}]}),{status:200})};
 try{const result=await makeSceneSnapshot({character:{name:'지우',age:'28',appearance:'검은 머리',personality:'차분함',world:'현대',opening:'안녕'},persona:null,summary:'',memories:[],messages:[{role:'user',content:'*거실에 앉았다.*'}]});assert.equal(result.location,'거실');assert.match(requested,/gemini-3\.1-flash-lite:generateContent/)}
 finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey}
});

test('empty scene analysis falls back to the latest dialogue and keeps generation moving',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';let attempts=0;
 globalThis.fetch=async()=>{attempts++;return new Response(JSON.stringify({candidates:[{content:{parts:[]},finishReason:'MAX_TOKENS'}]}),{status:200})};
 try{const result=await makeSceneSnapshot({character:{name:'지우',appearance:'검은 머리',opening:'어서 와'},persona:null,summary:'',memories:[],messages:[{role:'user',content:'*거실 소파에 앉았다.* 나 좀 봐.'}]});assert.equal(attempts,2);assert.equal(result.characters[0].name,'지우');assert.match(result.interaction,/거실 소파에 앉았다/)}
 finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey}
});

test('provider sends references to the selected image model and reads image output',async()=>{
 const previous=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';
 let captured;
 globalThis.fetch=async(url,options)=>{captured={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from('image').toString('base64')}}]}}]}),{status:200})};
 try{const result=await new GeminiImageProvider().generateScene('scene',[{mimeType:'image/jpeg',data:'aGVsbG8='}],'quality');assert.equal(result.bytes.toString(),'image');assert.match(captured.url,/gemini-3\.1-flash-image/);assert.equal(captured.body.contents[0].parts[1].inlineData.data,'aGVsbG8=');assert.equal(captured.body.generationConfig.responseFormat.image.imageSize,'2K')}
 finally{globalThis.fetch=previous;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey}
});

test('safety block is identified without an image',async()=>{
 const previous=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';
 globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'IMAGE_SAFETY'}]}),{status:200});
 try{await assert.rejects(()=>new GeminiImageProvider().generateScene('scene',[],'fast'),ImageBlockedError)}
 finally{globalThis.fetch=previous;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey}
});

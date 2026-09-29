import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot,scenePrompt} from '../lib/image-generation/scene.ts';
import {GeminiImageProvider,ImageBlockedError} from '../lib/image-generation/provider.ts';

test('snapshot keeps current outfit and identity instruction',()=>{
 const snapshot=parseSnapshot(JSON.stringify({characters:[{name:'도경',appearance:'검은 머리',clothing:'흰 셔츠',expression:'웃음',pose:'소파에 누움'}],location:'거실',time:'밤',lighting:'창밖 빛',camera:'아이폰',interaction:'올려다봄',mood:'친밀함'}));
 const prompt=scenePrompt(snapshot,'도경','조명을 더 어둡게');
 assert.match(prompt,/reference images define the visual identity/);
 assert.match(prompt,/흰 셔츠/);
 assert.match(prompt,/조명을 더 어둡게/);
});

test('provider sends references to the selected image model and reads image output',async()=>{
 const previous=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';
 let captured;
 globalThis.fetch=async(url,options)=>{captured={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from('image').toString('base64')}}]}}]}),{status:200})};
 try{const result=await new GeminiImageProvider().generateScene('scene',[{mimeType:'image/jpeg',data:'aGVsbG8='}],'quality');assert.equal(result.bytes.toString(),'image');assert.match(captured.url,/gemini-3-pro-image/);assert.equal(captured.body.contents[0].parts[1].inlineData.data,'aGVsbG8=');assert.equal(captured.body.generationConfig.responseFormat.image.imageSize,'2K')}
 finally{globalThis.fetch=previous;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey}
});

test('safety block is identified without an image',async()=>{
 const previous=globalThis.fetch,oldKey=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';
 globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'IMAGE_SAFETY'}]}),{status:200});
 try{await assert.rejects(()=>new GeminiImageProvider().generateScene('scene',[],'fast'),ImageBlockedError)}
 finally{globalThis.fetch=previous;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey}
});

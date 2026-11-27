import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import * as access from '../lib/dokyeong/image-reference.ts';
const id='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
const image=(await sharp({create:{width:20,height:20,channels:3,background:'#aaa'}}).jpeg().toBuffer()).toString('base64');
const refs={face:['data:image/jpeg;base64,'+image],body:['data:image/jpeg;base64,'+image]};
const token=url=>new URL(url).pathname.split('/').at(-1);
async function withKey(run){const old=process.env.CHARACTER_HISTORY_KEY;process.env.CHARACTER_HISTORY_KEY='test-signing-secret';try{await run();}finally{if(old===undefined)delete process.env.CHARACTER_HISTORY_KEY;else process.env.CHARACTER_HISTORY_KEY=old;}}
test('image grants expose only signed, expiring slots in reference order',()=>withKey(()=>{
 const urls=access.imageReferenceUrls(id,refs,null,'photo-123');
 const grants=urls.map(url=>access.verifyImageReference(token(url)));
 assert.deepEqual(grants.map(g=>g.kind),['face','body','source']);
 assert.equal(grants[2].messageId,'photo-123');
 for(const url of urls){assert.ok(!url.includes(image));assert.ok(!url.includes('test-signing-secret'));assert.ok(url.startsWith('https://haeon-relay.vercel.app/'));}
 assert.equal(access.verifyImageReference(token(urls[0]),Date.now()+600001),null);
 assert.deepEqual(access.imageReferenceUrls(undefined,{face:[],body:[]},null),[]);
 assert.throws(()=>access.imageReferenceUrls(undefined,refs,null));
}));
test('forged, altered and malformed grants cannot read another reference',()=>withKey(()=>{
 const good=token(access.imageReferenceUrls(id,refs,null)[0]);
 const [payload,signature]=good.split('.');
 const other=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload,'base64url')),characterId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'})).toString('base64url');
 for(const value of ['',good+'.x',other+'.'+signature,payload+'.'+'0'.repeat(64),'x'.repeat(1300)])assert.equal(access.verifyImageReference(value),null);
}));
test('reference route rejects before reading and serves only the granted image without caching',()=>withKey(async()=>{
 let reads=0;const queries=[];const exports={};
 const mocks={
  '@/lib/dokyeong/image-reference':access,
  '@/lib/dokyeong/characters':{readCharacterReferences:async target=>{reads++;assert.equal(target,id);return refs;},readLiveCharacter:async()=>({avatar_url:refs.face[0]})},
  '@/lib/dokyeong/memory':{serverRpc:async(_,body)=>{queries.push(body);return {dataUrl:refs.face[0]};}},
  sharp:{default:sharp},
 };
 const source=readFileSync(new URL('../app/api/dokyeong/image-reference/[token]/route.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Response,Buffer,Uint8Array});
 const get=value=>exports.GET(new Request('https://app.test'),{params:Promise.resolve({token:value})});
 assert.equal((await get('invalid')).status,404);assert.equal(reads,0);assert.equal(queries.length,0);
 const urls=access.imageReferenceUrls(id,refs,null,'photo-123');
 const response=await get(token(urls[0]));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.equal(response.headers.get('content-type'),'image/jpeg');assert.ok((await response.arrayBuffer()).byteLength>100);
 assert.equal((await get(token(urls[2]))).status,200);
 const board=access.imageReferenceUrls(id,refs,null,'photo-123',true);assert.equal(board.length,1);const boardResponse=await get(token(board[0]));assert.equal(boardResponse.status,200);const metadata=await sharp(Buffer.from(await boardResponse.arrayBuffer())).metadata();assert.equal(metadata.width,1024);assert.equal(metadata.height,1280);
 assert.equal(queries[0].target_character,id);assert.equal(queries[0].data.messageId,'photo-123');
}));

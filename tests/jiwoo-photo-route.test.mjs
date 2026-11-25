import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {STANDALONE_JIWOO_ID} from '../lib/dokyeong/character-modes.ts';

const source=readFileSync(new URL('../app/api/dokyeong/images/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function imageEndpoint() {
 const calls=[];const scheduled=[];
 const modules={
  'next/server':{after:fn=>scheduled.push(fn)},
  '@/lib/dokyeong/auth':{authenticated:()=>true,sameOrigin:()=>true,unauthorized:()=>new Response(null,{status:401}),noStore:{'Cache-Control':'no-store'}},
  '@/lib/dokyeong/memory':{serverRpc:async(name,body)=>{calls.push({name,body});return {id:body.target_job,status:'queued'};}},
  '@/lib/dokyeong/image-jobs':{runImageJob:async()=>{throw Error('Do not execute external image generation in unit tests');}},
 };
 const exports={};
 vm.runInNewContext(compiled,{exports,require:name=>{assert.ok(modules[name],name);return modules[name];},Response,console}, {filename:'app/api/dokyeong/images/route.ts'});
 return {POST:exports.POST,calls,scheduled};
}

test('Jiwoo newly requested photo enters authenticated GPT image queue',async()=>{
 const route=imageEndpoint();
 const requestId='d750f774-bc6f-4ad6-a67a-51fbdfe1f247';
 const payload={characterId:STANDALONE_JIWOO_ID,requestId,text:'지금 새로 셀카 찍어서 보내줘',scene:'거실에서 흰 티셔츠를 입고 휴대폰으로 새 셀카 촬영',context:'assistant: 집에서 쉬는 중'};
 const response=await route.POST(new Request('https://example.test/api/dokyeong/images',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
 assert.equal(response.status,202);
 assert.equal(route.calls.length,1);
 assert.equal(route.calls[0].name,'live_image_work');
 assert.equal(route.calls[0].body.action,'create');
 assert.equal(route.calls[0].body.target_character,STANDALONE_JIWOO_ID);
 assert.equal(route.calls[0].body.target_job,requestId);
 assert.equal(route.calls[0].body.data.scene,payload.scene);
 assert.equal(route.scheduled.length,1);
});

test('invalid photo job cannot reach persistent queue',async()=>{
 const route=imageEndpoint();
 const response=await route.POST(new Request('https://example.test/api/dokyeong/images',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({characterId:STANDALONE_JIWOO_ID,requestId:'invalid',text:'사진',scene:'사진'})}));
 assert.equal(response.status,400);
 assert.equal(route.calls.length,0);
 assert.equal(route.scheduled.length,0);
});

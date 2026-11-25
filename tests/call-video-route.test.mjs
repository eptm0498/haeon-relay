import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as callScenes from "../lib/dokyeong/call-scenes.ts";

const validUrl="https://ckesuyinmcqemgeemzlh.supabase.co/storage/v1/object/sign/jiwoo-call-videos/jiwoo-complete.mp4?token=abc";
const routeSource=fs.readFileSync(new URL("../app/api/dokyeong/call-video/route.ts",import.meta.url),"utf8");
function fixture({authorized=true,edgeStatus=200,signedUrl=validUrl,scene="complete"}={}) {
  let signingCalls=0, legacyCalls=0;
  let calledUrl="", calledOptions=null;
  const exports={};
  const mocks={
    "@/lib/dokyeong/auth":{authenticated:()=>authorized,noStore:{"Cache-Control":"no-store"},unauthorized:()=>new Response(null,{status:401})},
    "@/lib/dokyeong/call-scenes":callScenes,
    "@/lib/dokyeong/memory":{serverRpc:async()=>{legacyCalls++;return Buffer.from("dummy video").toString("base64");}},
  };
  vm.runInNewContext(ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},
    Response,URL,Uint8Array,Buffer,AbortSignal,
    process:{env:{CHARACTER_HISTORY_KEY:"server-secret"}},
    fetch:async(url,init)=>{signingCalls++;calledUrl=url;calledOptions=init;return Response.json({url:signedUrl},{status:edgeStatus});},
  });
  const request={nextUrl:new URL("https://app.test/api/dokyeong/call-video?scene="+scene),headers:new Headers()};
  return {GET:()=>exports.GET(request),get signingCalls(){return signingCalls;},get legacyCalls(){return legacyCalls;},get calledOptions(){return calledOptions;},get calledUrl(){return calledUrl;}};
}
test("video scene names include the uploaded completed video",()=>{
  assert.equal(callScenes.isCallVideoScene("complete"),true);
  assert.equal(callScenes.isCallVideoScene("intimate"),true);
  assert.equal(callScenes.isCallVideoScene("default"),true);
  assert.equal(callScenes.isCallVideoScene("unknown"),false);
});
test("completed video redirects only authenticated users to a short-lived private storage URL",async()=>{
  const f=fixture();
  const r=await f.GET();
  assert.equal(r.status,307);
  assert.equal(r.headers.get("Location"),validUrl);
  assert.match(r.headers.get("Cache-Control"),/no-store/);
  assert.equal(f.signingCalls,1);
  assert.equal(f.legacyCalls,0);
  assert.match(f.calledUrl,/jiwoo-video-asset/);
  assert.equal(f.calledOptions.headers["x-live-server-token"],"server-secret");
  assert.equal(f.calledOptions.method,"POST");
});
test("new video cannot be obtained without app authorization",async()=>{
  const f=fixture({authorized:false});
  const r=await f.GET();
  assert.equal(r.status,401);
  assert.equal(f.signingCalls,0);
});
test("an invalid or unavailable signed URL cannot become an open redirect",async()=>{
  for(const signedUrl of ["https://evil.example/video.mp4","http://ckesuyinmcqemgeemzlh.supabase.co/video.mp4","https://ckesuyinmcqemgeemzlh.supabase.co/storage/v1/object/public/example.mp4"]){
    assert.equal((await fixture({signedUrl}).GET()).status,503);
  }
  assert.equal((await fixture({edgeStatus:403}).GET()).status,503);
});
test("legacy video scenes still use their original private RPC transport",async()=>{
  const f=fixture({scene:"default"});
  const r=await f.GET();
  assert.equal(r.status,200);
  assert.equal(await r.text(),"dummy video");
  assert.equal(f.signingCalls,0);
  assert.equal(f.legacyCalls,1);
});

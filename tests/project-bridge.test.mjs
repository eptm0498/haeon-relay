import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const app='https://haeon-relay.vercel.app/dokyeong-live';
const chat='https://chatgpt.com/g/g-p-00000000000000000000000000000000/c/00000000-0000-0000-0000-000000000001';
function background(){
 let listener;const opened=[],responses=[];
 const chrome={runtime:{id:'own-extension',getManifest:()=>({version:'1.1.1'}),onMessage:{addListener:fn=>{listener=fn;}}},tabs:{create:async options=>{opened.push(options);return{id:9};},get:async()=>({status:'complete'}),update:async()=>{},remove:async()=>{}},scripting:{executeScript:async()=>[{result:{sourceUrl:chat.replace('/c/','-hanji/c/'),messages:[{id:'one',role:'user',content:'안녕'}],partial:false}}]}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/jiwoo-project-bridge/background.js',import.meta.url),'utf8'),{chrome,URL,Date,setTimeout});
 return {opened,responses,request:async(action,sender={id:'own-extension',url:app,tab:{id:7}})=>{listener({action,sourceUrl:chat},sender,r=>responses.push(r));await new Promise(setImmediate);return responses.at(-1);}};
}
test('valid content-script sender can capture without privileged tab.url metadata',async()=>{
 const h=background(),r=await h.request('capture');
 assert.equal(h.opened.length,1);assert.equal(r.sourceUrl,chat);assert.equal(r.messages.length,1);
});
test('ping verifies the worker without opening a chat tab',async()=>{
 const h=background(),r=await h.request('ping');
 assert.equal(r.ready,true);assert.equal(r.version,'1.1.1');assert.equal(r.captureProtocol,2);assert.equal(h.opened.length,0);
});
test('lookalike origins and foreign extension senders cannot open chats',async()=>{
 const h=background();
 for(const sender of [{id:'own-extension',url:app.replace('vercel.app','vercel.app.evil.test'),tab:{id:7}},{id:'other',url:app,tab:{id:7}},{id:'own-extension',url:app,frameId:4,tab:{id:7}}])await h.request('capture',sender);
 assert.equal(h.opened.length,0);
});
async function content(result){
 let listener;const sent=[],posted=[],window={addEventListener:(name,fn)=>{listener=fn;},postMessage:v=>posted.push(v)};
 const chrome={runtime:{sendMessage:async m=>{sent.push(m);if(result instanceof Error)throw result;return result;}}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/jiwoo-project-bridge/app-bridge.js',import.meta.url),'utf8'),{window,location:{origin:'https://haeon-relay.vercel.app'},chrome});
 await listener({source:window,origin:'https://haeon-relay.vercel.app',data:{channel:'jiwoo-project-bridge-v1',direction:'request',id:'fixture',action:'ping'}});
 return{sent,posted};
}
test('content-script ping must use a real worker reply instead of claiming ready itself',async()=>{
 const h=await content({ready:true,version:'1.1.1',captureProtocol:2});
 assert.equal(h.sent.length,1);assert.equal(h.posted[0].version,'1.1.1');assert.equal(h.posted[0].captureProtocol,2);
});
test('an invalidated extension context cannot report a healthy connection',async()=>{
 const h=await content(new Error('Extension context invalidated.'));
 assert.ok(h.posted[0].error);assert.notEqual(h.posted[0].ready,true);
});

function client(){
 const listeners=new Set(),exports={};let expire;
 const window={setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>{},addEventListener:(name,fn)=>listeners.add(fn),removeEventListener:(name,fn)=>listeners.delete(fn),postMessage:()=>{}};
 const code=ts.transpileModule(fs.readFileSync(new URL('../lib/dokyeong/project-bridge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,window,location:{origin:'https://haeon-relay.vercel.app'},crypto:{randomUUID:()=> 'request-fixture'}});
 return {api:exports,expire:()=>expire(),reply:data=>{for(const fn of listeners)fn({source:window,origin:'https://haeon-relay.vercel.app',data:{channel:'jiwoo-project-bridge-v1',direction:'response',id:'request-fixture',...data}});},listeners};
}
test('a stale old pong cannot win the race against the healthy worker',async()=>{
 const h=client(),p=h.api.projectBridge('ping');
 h.reply({ready:true,version:'1.1.0'});assert.equal(h.listeners.size,1);
 h.reply({ready:true,version:'1.1.1',captureProtocol:2});
 assert.equal((await p).version,'1.1.1');assert.equal(h.listeners.size,0);
});
test('legacy-only connections report their real version after discovery finishes',async()=>{
 const h=client(),p=h.api.projectBridge('ping');h.reply({ready:true,version:'1.1.0'});h.expire();
 assert.equal((await p).version,'1.1.0');assert.equal(h.listeners.size,0);
});
test('stale capture replies cannot turn a successful import into an empty result',async()=>{
 const h=client(),p=h.api.projectBridge('capture',chat);h.reply({error:'old context',messages:[]});
 h.reply({captureProtocol:2,sourceUrl:chat,messages:[{id:'a',role:'user',content:'안녕'}]});
 assert.equal((await p).messages.length,1);
});
test('missing workers time out with an actionable message and remove the listener',async()=>{
 const h=client(),p=h.api.projectBridge('ping');h.expire();
 await assert.rejects(p,/PC 크롬/);assert.equal(h.listeners.size,0);
});

test('the downloadable manifest and app release label agree',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../extensions/jiwoo-project-bridge/manifest.json',import.meta.url),'utf8'));
 assert.equal(client().api.PROJECT_BRIDGE_RELEASE,manifest.version);
});

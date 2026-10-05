import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('failed sync retains outbox, rejects reply prerequisite, and recovers without duplicates or stale ETag',async()=>{
 const storage=new Map(),states=[],effects=[],listeners=new Map(),seenTags=[];
 const id='1e50ad74-d4a0-4204-9064-ffa5c61530d2',epoch='441d2f87-a6da-4bde-8a33-df836df49f41';
 let outage=false,tag='"v1"',index=0;
 const row={character_id:id,epoch,messages:[{id:'seed',role:'assistant',content:'preserve existing',ts:1}],import_allowed:false};
 const react={useState(initial){const i=index++;states[i]=initial;return [initial,value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(value){return {current:value};},useCallback(fn){return fn;},useEffect(fn){effects.push(fn);}};
 const exports={};
 const fetch=async(_,options)=>{
  if(outage)return Response.json({error:'temporary failure'},{status:503});
  if(options.method==='POST'){
   const body=JSON.parse(options.body);for(const message of body.messages)if(!row.messages.some(m=>m.id===message.id))row.messages.push(message);
   tag='"v2"';return Response.json(row);
  }
  seenTags.push(options.headers['If-None-Match']||'');
  if(options.headers['If-None-Match']===tag)return new Response(null,{status:304});
  return Response.json([row],{headers:{etag:tag}});
 };
 const source=fs.readFileSync(new URL('../app/dokyeong-live/useSharedHistory.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:name=>{assert.equal(name,'react');return react;},fetch,AbortSignal,console,
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener(){},setInterval:()=>1,clearInterval(){}},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},
 });
 const api=exports.useSharedHistory([{id,is_default:true}],true);effects[0]();await api.synchronize();
 assert.equal(states[1],true);assert.equal(states[0][id][0].content,'preserve existing');
 outage=true;api.append(id,[{id:'pending',role:'user',content:'retain pending',ts:2}]);
 await assert.rejects(api.synchronize(),/temporary failure/);
 assert.equal(JSON.parse(storage.get('character-live-outbox-v1:'+id)).messages.length,1);
 assert.equal(states[0][id].length,2);
 outage=false;listeners.get('online')();await api.synchronize();
 assert.equal(storage.has('character-live-outbox-v1:'+id),false);
 assert.equal(row.messages.filter(m=>m.id==='pending').length,1);assert.equal(states[2],'');
 const fresh=exports.useSharedHistory([{id,is_default:true}],true);await fresh.synchronize();
 assert.equal(seenTags.at(-1),'','a new hook instance must load history, not reuse another instance ETag');
});

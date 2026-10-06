import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcTransport,retryAllowed} from '../lib/dokyeong/rpc-transport.ts';

test('only known reads and idempotent appends/enqueues can retry',()=>{
 assert.equal(retryAllowed('live_sync_history',{action:'append'}),true);
 assert.equal(retryAllowed('live_sync_history',{action:'read'}),true);
 assert.equal(retryAllowed('live_reply_work',{action:'enqueue'}),true);
 for(const action of ['claim','deliver','schedule','fail'])assert.equal(retryAllowed('live_reply_work',{action}),false);
 assert.equal(retryAllowed('live_sync_history',{action:'reset'}),false);
 assert.equal(retryAllowed('live_data_work',{action:'save_settings'}),false);
 assert.equal(retryAllowed('unknown_write',{}),false);
});
test('transient read recovers while capability conflicts and mutations are never replayed',async()=>{
 const original=globalThis.fetch;const log=console.error;console.error=()=>{};
 try{
  let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)throw Object.assign(Error('timeout'),{name:'TimeoutError'});return Response.json({ok:true});};
  assert.deepEqual(await rpcTransport('https://example.invalid/','private-key','live_sync_history',{action:'read'},100),{ok:true});assert.equal(calls,2);
  for(const code of ['40001','PT409']){
   calls=0;globalThis.fetch=async()=>{calls++;return Response.json({code},{status:409});};
   await assert.rejects(rpcTransport('https://example.invalid/','key','live_sync_history',{action:'append'},100),/VERSION_CONFLICT/);assert.equal(calls,1);
  }
  calls=0;globalThis.fetch=async()=>{calls++;throw Object.assign(Error('timeout'),{name:'TimeoutError'});};
  await assert.rejects(rpcTransport('https://example.invalid/','key','live_reply_work',{action:'claim'},100));assert.equal(calls,1);
 }finally{globalThis.fetch=original;console.error=log;}
});

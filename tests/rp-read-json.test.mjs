import test from 'node:test';
import assert from 'node:assert/strict';
import {readJsonResponse} from '../lib/rp/read-json.ts';

test('empty server body becomes a clear retryable message',async()=>{
 await assert.rejects(()=>readJsonResponse(new Response('',{status:500})),/빈 응답/);
 assert.deepEqual(await readJsonResponse(new Response('{"error":"장면 분석 실패"}',{status:500})),{error:'장면 분석 실패'});
});

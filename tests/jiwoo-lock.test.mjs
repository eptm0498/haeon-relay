import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as modes from '../lib/dokyeong/character-modes.ts';
import * as data from '../lib/dokyeong/jiwoo-lock-data.ts';

function fixture(readings=[{code:'0012',clear:true},{code:'0012',clear:true}]) {
 let state={epoch:'epoch',status:'empty',version:0},calls=[],ocr=0;
 const exports={};
 const rpc=async(_name,{action,data:input={}})=>{
  calls.push({action,input});if(action==='read')return {...state};
  if(input.expected_version!==state.version||input.epoch!==state.epoch||input.event_ms<(state.event_ms||0))return {...state,conflict:true};
  if(action==='begin')state={...state,session_id:'session-'+(state.version+1),status:'pending',cipher:null,source_event_id:input.event_id,event_id:input.event_id,event_ms:input.event_ms,received_at:new Date(input.event_ms).toISOString(),disclosed_at:null,version:state.version+1};
  else if(input.session_id!==state.session_id)return {...state,conflict:true};
  else if(action==='store')state={...state,status:'active',cipher:input.cipher,version:state.version+1};
  else if(action==='disclose')state={...state,status:'disclosed',disclosed_at:'2026-11-27T10:00:00Z',event_ms:input.event_ms,event_id:input.event_id,version:state.version+1};
  else if(action==='release')state={...state,status:'released',cipher:null,source_event_id:null,released_at:'2026-11-27T10:01:00Z',event_ms:input.event_ms,event_id:input.event_id,version:state.version+1};
  return {...state};
 };
 const mocks={'node:crypto':crypto,'./memory':{serverRpc:rpc},'./character-modes':modes,'./jiwoo-lock-data':data,'./gemini-json':{geminiJson:async(prompt,_schema,_signal,image,options)=>{
  assert.ok(image);assert.equal(options.temperature,0);assert.ok(!prompt.includes('0012'));return readings[ocr++%readings.length];
 }}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/dokyeong/jiwoo-lock.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:name=>{assert.ok(mocks[name],name);return mocks[name];},Buffer,process:{env:{CHARACTER_HISTORY_KEY:'offline-capability'}}});
 let turn=0;
 const run=(text,extra={})=>exports.jiwooLockTurn({characterId:modes.STANDALONE_JIWOO_ID,eventId:'event-'+(++turn),timestamp:1000+turn,epoch:'epoch',text,...extra});
 return {run,exports,calls,get state(){return state;},get ocr(){return ocr;}};
}

test('current code survives long conversations, preserves leading zeros and is removed only after confirmed opening',async()=>{
 const f=fixture();await f.run('이번 키 비밀번호는 0012야');
 assert.equal(f.state.status,'active');assert.ok(!f.state.cipher.includes('0012'));
 for(let i=0;i<60;i++){const result=await f.run('오늘 날씨 좋아');assert.ok(!result.context.includes('0012'));assert.equal(result.reply,undefined);}
 const first=await f.run('비번 알려줘');assert.ok(first.reply.includes('0012'));assert.equal(f.state.status,'disclosed');assert.ok(f.state.cipher);
 await f.run('안 열렸어. 번호가 틀린 건가?');assert.ok(f.state.cipher);
 const again=await f.run('번호 다시 불러줘');assert.ok(again.reply.includes('0012'));
 assert.ok((await f.run('그거 몇 번이야?')).reply.includes('0012'));
 await f.run('언제 풀었어?');assert.ok(f.state.cipher);
 await f.run('비번 0012로 열렸어');assert.equal(f.state.status,'released');assert.equal(f.state.cipher,null);assert.ok(f.state.released_at);
 assert.ok((await f.run('언제 해제했어?')).reply.includes('19시'));
 const absent=await f.run('비밀번호 뭐야');assert.ok(!absent.reply.includes('0012'));assert.ok(absent.reply.includes('정확히 확인할 수 없어'));
});
test('a new lock invalidates the previous code before OCR and conflicting OCR never restores it',async()=>{
 const f=fixture([{code:'3456',clear:true},{code:'3458',clear:true}]);
 await f.run('이번 비밀번호는 0012');
 await f.run('이번 키 비번 사진이야',{image:{mimeType:'image/jpeg',data:'fixture'}});
 assert.equal(f.ocr,2);assert.equal(f.state.status,'pending');assert.equal(f.state.cipher,null);
 const result=await f.run('비번 알려줘');assert.ok(!result.reply.includes('0012'));
});
test('matching image readings save once; retries do not reread or replace the same session',async()=>{
 const f=fixture();const extra={eventId:'image-message',timestamp:2000,image:{mimeType:'image/jpeg',data:'fixture'}};
 await f.run('이번 키 비밀번호 사진',extra);const session=f.state.session_id;
 await f.run('이번 키 비밀번호 사진',extra);assert.equal(f.ocr,2);assert.equal(f.state.session_id,session);
 assert.ok((await f.run('번호 알려줘',{timestamp:2100})).reply.includes('0012'));
});
test('old, future, login credentials and fictional scene actions never become a current lock fact',async()=>{
 const f=fixture();
 for(const text of ['어제 비번 1234였어','내일 비밀번호 5678로 하자','구글 로그인 비밀번호 4567','*지우가 비밀번호 8765를 저장한다*'])await f.run(text);
 assert.equal(f.state.status,'empty');
 await f.run('이번 키 비밀번호는 0012');
 await f.run('*지우가 잠금을 해제했다*');assert.ok(f.state.cipher);
 await f.run('수학 문제 다 풀었어');assert.ok(f.state.cipher);
});
test('stale jobs and a reset conversation cannot recover or overwrite the latest session',async()=>{
 const f=fixture();await f.run('이번 비번 0012',{timestamp:2000});await f.run('이번 비번 5678',{timestamp:3000});
 await f.run('이번 비번 8765',{timestamp:2500});
 assert.ok((await f.run('비번 알려줘',{timestamp:3100})).reply.includes('5678'));
 const result=await f.run('비번 알려줘',{epoch:'old-epoch',timestamp:3200});assert.ok(!result.reply.includes('5678'));
});
test('only standalone Jiwoo uses lock storage; encryption binds data to the current session and epoch',async()=>{
 const f=fixture();await f.run('이번 비번 0012',{characterId:'another-character'});assert.equal(f.calls.length,0);
 const encrypted=f.exports.encryptLockCode('0012','one','epoch');assert.equal(f.exports.decryptLockCode(encrypted,'one','epoch'),'0012');
 assert.throws(()=>f.exports.decryptLockCode(encrypted,'two','epoch'));assert.throws(()=>f.exports.decryptLockCode(encrypted,'one','reset'));
 assert.throws(()=>f.exports.encryptLockCode('','one','epoch'));
});
test('conversational memory redacts old lock digits and key photos but preserves unrelated facts',()=>{
 const messages=[{role:'user',content:'키 비밀번호 0012',image:{data:'secret'}},{role:'assistant',content:'0012 확인했어'},{role:'user',content:'풀었어'}];
 const redacted=data.redactLockMessages(messages);assert.ok(!JSON.stringify(redacted).includes('0012'));assert.equal(redacted[0].image,undefined);
 assert.equal(data.redactLockText('내 키는 171cm야'),'내 키는 171cm야');
 assert.ok(!data.redactLockText('키 비밀번호\n0012').includes('0012'));
 assert.ok(!data.guardLockReply('비번은 9876야','키 비밀번호를 물었다').includes('9876'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {monologueContext, callMonologuePrompt, monologueReply} from '../lib/dokyeong/call-monologue.ts';

test('long silence preserves the actual conversation and keeps advancing beyond the request window', () => {
  const start = [{role:'assistant',content:'이번 주말에 같이 요리해 보자.'},
    {role:'user',content:'나는 매운 음식은 못 먹어.'}];
  const history = [...start, ...Array.from({length:80}, (_,i)=>({role:'assistant',content:`혼잣말 ${i}`}))];
  const context = monologueContext(history);
  assert.equal(context.messages.length,19);
  assert.deepEqual(context.messages.slice(0,2),start);
  assert.equal(context.messages.at(-1).content,'혼잣말 79');
  assert.equal(context.monologueTurn,80);
  assert.equal(monologueContext([...history,{role:'assistant',content:'새 이야기'}]).monologueTurn,81);
  assert.equal(monologueContext([...history,{role:'user',content:'이제 다른 얘기하자'}]).monologueTurn,0);
});

test('the original chronological rolling history is retained when it contains the caller', () => {
  const history = [{role:'user',content:'나 오늘 게임했어'}, {role:'assistant',content:'재밌었겠다'}];
  assert.deepEqual(monologueContext(history).messages,history);
  assert.deepEqual(monologueContext([]),{messages:[],monologueTurn:0});
});

test('successive turns have different goals and preserve meaning-level repetition avoidance', () => {
  const history=[{role:'user',content:'주말 요리'}, {role:'assistant',content:'나만 봐'}];
  const prompts=Array.from({length:8},(_,i)=>callMonologuePrompt(history,i));
  assert.equal(new Set(prompts.map(p=>p.split('이번 발화의 방향은 다음과 같아.')[1].split('\n')[1])).size,8);
  for(const prompt of prompts) {
    assert.match(prompt,/의미가 같은 요구/);
    assert.match(prompt,/나만 봐/);
    assert.match(prompt,/형의 침묵을 동의나 실제 행동의 증거로 삼지 마/);
  }
});

test('spoken and visible monologues retain a small story and cap runaway output', () => {
  assert.equal(monologueReply('나 생각났어. 우리 요리하면 재밌겠다. 매운 건 빼고. 그다음 말.'),
    '나 생각났어. 우리 요리하면 재밌겠다. 매운 건 빼고.');
  assert.equal(monologueReply('2.5시간쯤 걸릴까? 생각보다 오래네.'),'2.5시간쯤 걸릴까? 생각보다 오래네.');
  assert.ok(Array.from(monologueReply('새로운 이야기 '.repeat(100))).length<=300);
  assert.equal(monologueReply('  '),'');
});

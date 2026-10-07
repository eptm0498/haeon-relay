import test from 'node:test';import assert from 'node:assert/strict';
import {timingPlan,urgentMessage} from '../lib/dokyeong/reply-timing.ts';
test('departure reserves realistic time and an explicit duration wins',()=>{
 assert.equal(timingPlan({delaySeconds:8,awaySeconds:0},'씻고 올게.').awaySeconds,900);
 assert.equal(timingPlan({delaySeconds:8,awaySeconds:1200},'30분 정도 운동하고 올게.').awaySeconds,1800);
 assert.equal(timingPlan({awaySeconds:0},'밥 먹고 올게.').awaySeconds,1800);
 assert.equal(timingPlan({awaySeconds:0},'자고 일어나서 연락할게.').awaySeconds,25200);
});
test('past, denied, completed and user actions cannot start character activity',()=>{
 for(const text of ['샤워하고 왔어.','어제 운동하고 왔지.','안 씻고 올게.','형이 씻고 오면 연락할게.','도혁아 씻고 와.','사진 기다려.'])assert.equal(timingPlan({awaySeconds:1200},text).awaySeconds,0,text);
});
test('clock promises use KST including midnight and impossible values are bounded',()=>{
 const now=Date.parse('2026-10-05T14:40:00Z');
 assert.equal(timingPlan({awaySeconds:900},'씻고 밤 12시에 연락할게.',now).awaySeconds,1200);
 assert.equal(timingPlan({delaySeconds:Infinity,awaySeconds:Infinity},'씻고 올게.').delaySeconds,8);
 assert.equal(timingPlan({delaySeconds:999999,awaySeconds:999999},'방송하고 올게.').awaySeconds,86400);
});
test('urgent needs and cancellations interrupt the wait',()=>{
 assert.equal(urgentMessage('지금 숨을 못 쉬겠어 살려줘'),true);
 assert.equal(urgentMessage('가지마 급해 지금 바로 답해'),true);
 assert.equal(urgentMessage('오늘 재밌었어'),false);
});

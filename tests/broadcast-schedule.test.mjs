import test from 'node:test';
import assert from 'node:assert/strict';
import {onyuBroadcast,currentTimeContext} from '../lib/dokyeong/time-context.ts';
import {timingPlan} from '../lib/dokyeong/reply-timing.ts';

test('KST Wednesday and Saturday broadcasts include midnight and exclude 09:00',()=>{
 for(const [time,active] of [
  ['2026-10-07T18:29:59+09:00',false],['2026-10-07T18:30:00+09:00',true],
  ['2026-10-07T23:59:59+09:00',true],['2026-10-08T00:00:00+09:00',true],
  ['2026-10-08T08:59:59+09:00',true],['2026-10-08T09:00:00+09:00',false],
  ['2026-10-10T18:30:00+09:00',true],['2026-10-11T08:59:59+09:00',true],
  ['2026-10-11T09:00:00+09:00',false],['2026-10-12T18:30:00+09:00',false],
 ]) assert.equal(onyuBroadcast(new Date(time)).active,active,time);
});
test('broadcast end and next session remain correct across dates and weeks',()=>{
 const active=onyuBroadcast(new Date('2026-10-07T18:30:00+09:00'));
 assert.equal(active.end.toISOString(),'2026-10-08T00:00:00.000Z');
 assert.equal(active.remainingSeconds,52200);
 const next=onyuBroadcast(new Date('2026-10-11T09:00:00+09:00'));
 assert.equal(next.start.toISOString(),'2026-10-14T09:30:00.000Z');
 assert.equal(onyuBroadcast(new Date('2026-12-30T23:00:00+09:00')).end.toISOString(),'2026-12-31T00:00:00.000Z');
});
test('only Onyu receives live schedule context, with current time and cancellation priority',()=>{
 const now=new Date('2026-10-07T15:00:00Z');
 const context=currentTimeContext(now,'55af4088-3e3c-4da8-a45a-1f6bbb69c57f');
 assert.match(context,/지금은 정기 방송 시간이다/);
 assert.match(context,/종료까지 32400초/);
 assert.match(context,/휴방이 명시됐으면/);
 assert.doesNotMatch(currentTimeContext(now,'other'),/정기 방송/);
});
test('a return after the full 14.5 hour broadcast is not cut off at 12 hours',()=>{
 const now=Date.parse('2026-10-07T18:30:00+09:00');
 assert.equal(timingPlan({awaySeconds:52200},'방송하고 올게. 오전 9시에 연락할게.',now).awaySeconds,52200);
 assert.equal(timingPlan({delaySeconds:52200},'방송 중이라 끝나고 확인했어.',now).delaySeconds,52200);
});

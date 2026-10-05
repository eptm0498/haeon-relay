import test from 'node:test';import assert from 'node:assert/strict';
import {wantsPhoto} from '../lib/dokyeong/photo-intent.ts';
import {parsePhotoCall} from '../lib/dokyeong/photo-tool.ts';
import {koreaTime} from '../lib/dokyeong/time-context.ts';
import {validSubscription} from '../lib/dokyeong/push-subscription.ts';
test('photo intent resolves agreed follow-ups and rejects refusals',()=>{
 assert.equal(wantsPhoto('응 보내줘','셀카 보내줄까?'),true);assert.equal(wantsPhoto('사진은 보내지 마'),false);
 assert.equal(wantsPhoto('응 보내줘','문서를 보내줄까?'),false);
 assert.equal(wantsPhoto('그렇게 찍어줘','흰 티셔츠 셀카로 해줄까?'),true);
});
test('only the bounded image function can request generation',()=>{
 assert.equal(parsePhotoCall({functionCall:{name:'delete_history',args:{}}}),null);
 assert.equal(parsePhotoCall({functionCall:{name:'send_character_photo',args:{scene:'x'.repeat(1801)}}}),null);
 assert.deepEqual(parsePhotoCall({functionCall:{name:'send_character_photo',args:{scene:'카페에서 흰 티셔츠 셀카',waitMessage:'형, 잠깐만 기다려.'}}}),{scene:'카페에서 흰 티셔츠 셀카',waitMessage:'형, 잠깐만 기다려.'});
});
test('time is Korea local time even on a UTC server',()=>{assert.match(koreaTime(new Date('2026-10-05T15:30:00Z')),/10월 6일/);});
test('push subscriptions cannot address arbitrary servers or credentials',()=>{
 const value={endpoint:'https://web.push.apple.com/test',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};
 assert.equal(validSubscription(value),true);
 for(const endpoint of ['http://web.push.apple.com/a','https://127.0.0.1/x','https://web.push.apple.com.evil.example/a','https://user:password@web.push.apple.com/a','https://web.push.apple.com:8443/a'])assert.equal(validSubscription({...value,endpoint}),false);
});

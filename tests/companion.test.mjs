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
import {sleepIntent} from '../lib/dokyeong/sleep-intent.ts';
test('photo refusals never force image generation',()=>{
 for(const value of ['사진 보내달라는 게 아니야','사진 보내지 말고 얘기하자','셀카 필요 없어','사진 찍어달라는 게 아니라 그냥 궁금했어'])assert.equal(wantsPhoto(value),false,value);
 assert.equal(wantsPhoto('사진 보내줘'),true);
});
test('sleep cues distinguish past events and denial from current intent',()=>{
 for(const value of ['어제 자려고 했는데 잠이 안 왔어','자려고 한 게 아니야','수면제 안 먹었어'])assert.equal(sleepIntent(value),false,value);
 for(const value of ['이제 잘게','수면제 먹었어','지금 자려고 누웠어'])assert.equal(sleepIntent(value),true,value);
});

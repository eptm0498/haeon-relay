import test from 'node:test';import assert from 'node:assert/strict';
import {wantsPhoto,ordinaryBodyPhotoRequest,photoReplyDeclines,photoIntentContext,photoFallbackAllowed} from '../lib/dokyeong/photo-intent.ts';
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
test('ordinary abdomen requests are visual, not food mentions or cancelled requests',()=>{
 for(const value of ['그냥그래 오랜만에 배 보여줘','복근 좀 보여줘','복부를 보여주세요','상체 보고 싶어'])assert.equal(ordinaryBodyPhotoRequest(value),true,value);
 for(const value of ['배 고파','배 아파서 쉬고 있어','택배 보여줘','배 보여달라는 게 아니야','배 사진은 보내지 마'])assert.equal(ordinaryBodyPhotoRequest(value),false,value);
 assert.equal(wantsPhoto('그냥그래 오랜만에 배 보여줘'),true);
});
test('a first or repeated request cannot force a photo over a current refusal',()=>{
 for(const reply of ['배 사진은 안 보낼래','사진 보여주기 싫어','사진은 보내지 않을게','절대 안 해.','아 왐마 카페에서 뭔 배를 보여줘']){
  assert.equal(photoReplyDeclines(reply),true,reply);
  assert.equal(photoFallbackAllowed('배 보여줘',reply),false,reply);
  assert.equal(photoFallbackAllowed('다시 배 보여줘',reply),false,reply);
 }
 assert.equal(photoFallbackAllowed('배 보여줘','잠깐만, 사진 찍어서 보내줄게.'),true);
 assert.equal(photoFallbackAllowed('배 보여줘','배 사진 정도는 부담 없어. 잠깐만.'),true);
 assert.equal(photoFallbackAllowed('배 보여줘','지금은 안 할래.'),false);
 assert.equal(photoFallbackAllowed('배 보여줘','일단 얘기나 하자.'),false);
 const history=[{role:'assistant',content:'셀카 보내줄까?'},{role:'user',content:'응'},{role:'assistant',content:'지금은 사진 안 보낼래'},{role:'user',content:'응 보내줘'}];
 assert.equal(photoIntentContext(history),'');
 assert.equal(photoFallbackAllowed('응 보내줘','그건 못해.',photoIntentContext(history)),false);
});
test('sleep cues distinguish past events and denial from current intent',()=>{
 for(const value of ['어제 자려고 했는데 잠이 안 왔어','자려고 한 게 아니야','수면제 안 먹었어'])assert.equal(sleepIntent(value),false,value);
 for(const value of ['이제 잘게','수면제 먹었어','지금 자려고 누웠어'])assert.equal(sleepIntent(value),true,value);
});

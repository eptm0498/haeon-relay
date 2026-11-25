import test from 'node:test';import assert from 'node:assert/strict';
import {wantsPhoto,ordinaryBodyPhotoRequest,photoReplyDeclines,photoIntentContext,photoFallbackAllowed,photoRequestPrompt,DURI_ORDINARY_PHOTO_PREFERENCE,wantsFreshPhoto} from '../lib/dokyeong/photo-intent.ts';
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
test('Duri accepts ordinary photos by current preference without inheriting a refusal loop',()=>{
 const prompt=photoRequestPrompt('두리');
 assert.ok(prompt.includes(DURI_ORDINARY_PHOTO_PREFERENCE));
 for(const clause of ['기본 반응은 짧게 받아주고 실제 사진 기능','복근이 선명하지 않아도 현재 모습 그대로','고정 성격이나 영구적인 사진 금지 규칙','이미 다른 장소에 도착했다고 꾸미지 마','나이·동의·생성 기준','사용자의 취소'])assert.ok(prompt.includes(clause),clause);
 for(const name of ['도경','온유'])assert.ok(!photoRequestPrompt(name).includes(DURI_ORDINARY_PHOTO_PREFERENCE),name);
 assert.equal(photoFallbackAllowed('사진 보내지 마','잠깐만, 보내줄게.'),false);
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

import {parseJiwooUserMessage,formatJiwooUserMessage,jiwooSceneSystemPrompt,jiwooSpokenText} from '../lib/dokyeong/character-modes.ts';
test('asterisk scenes are canonical scene events and never spoken dialogue',()=>{
 const parts=parseJiwooUserMessage('*지우가 침대에서 일어나 옆자리에 앉는다* 오늘 일찍 왔네? *도혁이 말없이 고개를 끄덕인다*');
 assert.deepEqual(parts,[{kind:'지문',text:'지우가 침대에서 일어나 옆자리에 앉는다'},{kind:'대사',text:'오늘 일찍 왔네?'},{kind:'지문',text:'도혁이 말없이 고개를 끄덕인다'}]);
 assert.deepEqual(parseJiwooUserMessage('*말없이 지우를 안는다*'),[{kind:'지문',text:'말없이 지우를 안는다'}]);
 assert.equal(formatJiwooUserMessage('오늘 어때?'),'오늘 어때?');
 assert.equal(jiwooSpokenText('*지우가 새 사진을 찍어서 보낸다*'),'');
 assert.equal(wantsPhoto(jiwooSpokenText('*지우가 새 사진을 찍어서 보낸다*')),false);
 assert.equal(jiwooSpokenText('*지우가 앉는다* 셀카 새로 찍어서 보내줘'),'셀카 새로 찍어서 보내줘');
 assert.equal(formatJiwooUserMessage('4*5는 20'), '4*5는 20');
 const scene=jiwooSceneSystemPrompt([{role:'assistant',content:'왜?'},{role:'user',content:'*지우가 침대에서 일어난다*'}]);
 assert.match(scene,/장면 상태/);assert.match(scene,/이미 성립한/);assert.match(scene,/지우가 침대에서 일어난다/);
 assert.equal(jiwooSceneSystemPrompt([{role:'user',content:'*지우가 일어난다*'},{role:'assistant',content:'응'}]),'');
});
test('fresh photo is generated while ordinary album requests stay eligible for reuse',()=>{
 for(const value of ['지금 새로 셀카 찍어서 보내줘','사진 찍어줘','셀카 찍어줘','한 장 찍어줘','사진 생성해서 보내줘','지금 찍어서 보내줘','방금처럼 다시 찍어줘']){
  assert.equal(wantsFreshPhoto(value),true,value);assert.equal(wantsPhoto(value),true,value);
 }
 for(const value of ['사진 보여줘','예전에 찍은 사진 보여줘','지금 예전에 찍은 사진 보내줘','그 사진 다시 보여줘','사진 찍지 마','사진 얘기한 거야'])assert.equal(wantsFreshPhoto(value),false,value);
 assert.equal(wantsPhoto('지금 찍어서 보내줘'),true);
});

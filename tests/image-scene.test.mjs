import test from 'node:test';
import assert from 'node:assert/strict';
import {photoScenePrompt,parsePhotoScene} from '../lib/dokyeong/image-scene.ts';

test('keeps the latest request separate from conflicting drafts and old memory',()=>{
  const prompt=photoScenePrompt({name:'도경',characterPrompt:'성인 남성',request:'배 보여줘',proposedScene:'얼굴만 보이는 셀카',context:'지금 흰 티셔츠와 청 반바지를 입고 집에 있어.',memory:'전에 카페에 갔음.',editing:false});
  assert.ok(prompt.endsWith('[최신 사용자 원문]\n배 보여줘'));
  assert.ok(prompt.includes('흰 티셔츠와 청 반바지'));
  assert.ok(prompt.includes('[기존 장면 초안]\n얼굴만 보이는 셀카'));
});
test('retains contextual edit instructions and validates the scene contract',()=>{
  const prompt=photoScenePrompt({name:'도경',characterPrompt:'성인 남성',request:'그 사진에서 옷만 흰색으로 바꿔',proposedScene:'집에서 찍은 사진',editing:true});
  assert.ok(prompt.includes('지정한 부분만 바꾸고'));
  assert.deepEqual(parsePhotoScene({appearance:' 성인 남성 ',scene:' 집에서 흰 티셔츠를 입은 사진 '}),{appearance:'성인 남성',scene:'집에서 흰 티셔츠를 입은 사진'});
  for(const invalid of [null,{}, {appearance:'성인 남성',scene:' '},{appearance:'a'.repeat(1201),scene:'사진'}, {appearance:'성인 남성',scene:'a'.repeat(1801)}]) assert.throws(()=>parsePhotoScene(invalid));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { JIWOO_AFFECTION_PHOTOS, JIWOO_BEDTIME_SCENES, jiwooBedtimeCue, jiwooBedtimePhotoId, jiwooScenePhotos, pickJiwooBedtimePhoto } from '../lib/dokyeong/jiwoo-bedtime.ts';
import { isCallPhotoId } from '../lib/dokyeong/call-scenes.ts';

test('bedtime dialogue selects related photos and ordinary chat leaves the scene alone', {}, () => {
  for (const [line, slot] of [['지우야 꽉 안아줘', 2], ['안고 같이 자자', 7]]) {
    const options = jiwooBedtimeCue(line);
    assert.ok(options);
    assert.equal(pickJiwooBedtimePhoto(options, [], {}, () => 0), jiwooBedtimePhotoId(slot));
  }
  assert.equal(jiwooBedtimeCue('오늘 학원에서 수업이 길었어.'), null);
});

test('embraces can be selected for hugs', {}, () => {
  const embraceSlots = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  for (const line of ['그냥 나 좀 안아줘', '지우야 꽉 안아줘']) {
    const candidates = jiwooBedtimeCue(line);
    assert.deepEqual(candidates?.slice(-embraceSlots.length), embraceSlots);
    assert.equal(pickJiwooBedtimePhoto(candidates, [jiwooBedtimePhotoId(32)], {}, () => 0.999), jiwooBedtimePhotoId(31));
  }
});

test('requests for affection take priority over hug, chest, and sleep cues', {}, () => {
  for (const line of ['오구오구 해줘', '오구, 오구', '나 좀 예뻐해 줘', '귀엽다고 해줘', '가슴에 안아주고 사랑한다고 말해 줘', '이불 덮고 같이 자면서 토닥토닥해 줘']) {
    assert.equal(jiwooBedtimeCue(line), JIWOO_AFFECTION_PHOTOS);
  }
  assert.equal(jiwooBedtimeCue('오늘 하늘이 너무 예뻐.'), null);
  const ids = JIWOO_AFFECTION_PHOTOS.map(jiwooBedtimePhotoId);
  assert.equal(ids.length, 10);
  assert.deepEqual(ids.map((_, i) => pickJiwooBedtimePhoto(JIWOO_AFFECTION_PHOTOS, [], {}, () => (i + 0.5) / ids.length)), ids);
  assert.equal(pickJiwooBedtimePhoto(JIWOO_AFFECTION_PHOTOS, ids.slice(0, 4), {}, () => 0), ids[4]);
});

test('chest and abdomen close-ups take priority over a generic sleep cue', {}, () => {
  const options = jiwooBedtimeCue('지우 가슴에 기대서 같이 자자');
  assert.deepEqual(options, [11, 12, 13, 15, 17, 18, 20, 21, 22]);
  assert.equal(pickJiwooBedtimePhoto(options, [], {}, () => 0), jiwooBedtimePhotoId(11));
  assert.equal(pickJiwooBedtimePhoto(options, [jiwooBedtimePhotoId(11)], {}, () => 0), jiwooBedtimePhotoId(12));
  const abdomen = jiwooBedtimeCue('배를 안고 같이 자자');
  assert.deepEqual(abdomen, [14, 16, 19]);
  assert.equal(pickJiwooBedtimePhoto(abdomen, [], {}, () => 0), jiwooBedtimePhotoId(14));
  assert.equal(pickJiwooBedtimePhoto(abdomen, [jiwooBedtimePhotoId(14)], {}, () => 0), jiwooBedtimePhotoId(16));
  assert.equal(pickJiwooBedtimePhoto(abdomen, [jiwooBedtimePhotoId(14), jiwooBedtimePhotoId(16)], {}, () => 0), jiwooBedtimePhotoId(19));
  assert.equal(jiwooBedtimeCue('오늘 배 안 아파.'), null);
});

test('random rotation can reach every private photo and skips the recent shots', {}, () => {
  const ids = JIWOO_BEDTIME_SCENES.map((_, i) => jiwooBedtimePhotoId(i + 1));
  assert.equal(ids.length, 42);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(isCallPhotoId));
  assert.deepEqual(ids.map((_, i) => pickJiwooBedtimePhoto(null, [], {}, () => (i + 0.5) / ids.length)), ids);
  assert.equal(pickJiwooBedtimePhoto(null, ids.slice(0, 4), {}, () => 0), ids[4]);
  assert.equal(pickJiwooBedtimePhoto([1, 2], ids.slice(0, 4), {}, () => 0), ids[1]);
});

test('light, bedding, and eye contact phrases leave automatic rotation in control', () => {
  for (const line of ['불 좀 꺼줘', '불빛 낮춰줘', '이불 덮어줘', '담요 좀 덮어줘', '마주 보자', '눈 맞춰줘', '베개 같이 쓰자']) {
    assert.equal(jiwooBedtimeCue(line), null);
  }
  assert.equal(jiwooScenePhotos('affection'), JIWOO_AFFECTION_PHOTOS);
  assert.equal(jiwooScenePhotos('toString'), null);
});

test('automatic rotation catches up photos skipped during contextual turns', () => {
  const ids = JIWOO_BEDTIME_SCENES.map((_, i) => jiwooBedtimePhotoId(i + 1));
  const counts = Object.fromEntries(ids.slice(0, 12).map(id => [id, 1]));
  let recent = ids.slice(0, 4);
  for (let i = 0; i < 30; i++) {
    const next = pickJiwooBedtimePhoto(null, recent, counts, () => 0);
    assert.equal(counts[next], undefined);
    counts[next] = 1;
    recent = [next, ...recent].slice(0, 4);
  }
  assert.ok(ids.every(id => counts[id] === 1));
});

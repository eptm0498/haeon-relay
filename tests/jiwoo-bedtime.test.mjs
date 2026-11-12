import assert from 'node:assert/strict';
import test from 'node:test';
import { JIWOO_BEDTIME_SCENES, jiwooBedtimeCue, jiwooBedtimePhotoId, pickJiwooBedtimePhoto } from '../lib/dokyeong/jiwoo-bedtime.ts';
import { isCallPhotoId } from '../lib/dokyeong/call-scenes.ts';

test('bedtime dialogue selects related photos and ordinary chat leaves the scene alone', () => {
  for (const [line, slot] of [['지우야 꽉 안아줘', 2], ['이불 덮어줘', 8], ['불 좀 꺼줘', 6], ['안고 같이 자자', 7]]) {
    const options = jiwooBedtimeCue(line);
    assert.ok(options);
    assert.equal(pickJiwooBedtimePhoto(options, [], () => 0), jiwooBedtimePhotoId(slot));
  }
  assert.equal(jiwooBedtimeCue('오늘 학원에서 수업이 길었어.'), null);
});

test('chest and abdomen close-ups take priority over a generic sleep cue', () => {
  const options = jiwooBedtimeCue('지우 가슴에 기대서 같이 자자');
  assert.deepEqual(options, [11, 12, 13, 15]);
  assert.equal(pickJiwooBedtimePhoto(options, [], () => 0), jiwooBedtimePhotoId(11));
  assert.equal(pickJiwooBedtimePhoto(options, [jiwooBedtimePhotoId(11)], () => 0), jiwooBedtimePhotoId(12));
  const abdomen = jiwooBedtimeCue('배를 안고 같이 자자');
  assert.deepEqual(abdomen, [14, 16]);
  assert.equal(pickJiwooBedtimePhoto(abdomen, [], () => 0), jiwooBedtimePhotoId(14));
  assert.equal(pickJiwooBedtimePhoto(abdomen, [jiwooBedtimePhotoId(14)], () => 0), jiwooBedtimePhotoId(16));
  assert.equal(jiwooBedtimeCue('오늘 배 안 아파.'), null);
});

test('random rotation can reach all sixteen private photos and skips the recent shots', () => {
  const ids = JIWOO_BEDTIME_SCENES.map((_, i) => jiwooBedtimePhotoId(i + 1));
  assert.equal(new Set(ids).size, 16);
  assert.ok(ids.every(isCallPhotoId));
  assert.deepEqual(ids.map((_, i) => pickJiwooBedtimePhoto(null, [], () => (i + 0.5) / ids.length)), ids);
  assert.equal(pickJiwooBedtimePhoto(null, ids.slice(0, 4), () => 0), ids[4]);
  assert.equal(pickJiwooBedtimePhoto([1, 2], ids.slice(0, 4), () => 0), ids[1]);
});

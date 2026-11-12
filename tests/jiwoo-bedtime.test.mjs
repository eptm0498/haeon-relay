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

test('random rotation can reach all ten private photos and skips the recent shots', () => {
  const ids = JIWOO_BEDTIME_SCENES.map((_, i) => jiwooBedtimePhotoId(i + 1));
  assert.equal(new Set(ids).size, 10);
  assert.ok(ids.every(isCallPhotoId));
  assert.equal(pickJiwooBedtimePhoto(null, [], () => 0.99), ids[9]);
  assert.equal(pickJiwooBedtimePhoto(null, ids.slice(0, 4), () => 0), ids[4]);
  assert.equal(pickJiwooBedtimePhoto([1, 2], ids.slice(0, 4), () => 0), ids[1]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { measureVisualMotion } from '../lib/dokyeong/camera-motion.ts';

const PIXELS = 24 * 18;
const solid = brightness => Array(PIXELS * 3).fill(brightness);

test('still camera and a uniform change in auto-exposure do not generate movement', () => {
 const baseline = solid(75);
 assert.equal(measureVisualMotion(baseline, baseline).significant, false);
 const brighter = solid(102);
 const result = measureVisualMotion(baseline, brighter);
 assert.equal(result.significant, false);
 assert.ok(result.meanDifference < 0.001);
});

test('localized movement can trigger even though most of the scene remains unchanged', () => {
 const baseline = solid(75);
 const changed = [...baseline];
 for (let pixel = 100; pixel < 132; pixel++) {
  changed[pixel * 3] = 225;
  changed[pixel * 3 + 1] = 175;
  changed[pixel * 3 + 2] = 195;
 }
 const result = measureVisualMotion(baseline, changed);
 assert.equal(result.significant, true);
 assert.ok(result.changedFraction > 0.05);
});

test('a few noisy cells do not trigger an unsolicited spoken response', () => {
 const baseline = solid(75);
 const changed = [...baseline];
 for (let pixel = 100; pixel < 104; pixel++) {
  changed[pixel * 3] = 255;
 }
 assert.equal(measureVisualMotion(baseline, changed).significant, false);
});

test('missing and incompatible frame signatures are rejected', () => {
 assert.equal(measureVisualMotion([], []).significant, false);
 assert.equal(measureVisualMotion([0,0,0], [0,0]).significant, false);
});

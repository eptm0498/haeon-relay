import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVisualMonologueTurn } from '../lib/dokyeong/visual-monologue.ts';

const now = 100_000;
const base = { now, lastMotionAt: now - 1_000, reactedMotionAt: 0, lastRequestAt: 0, lastSpeechAt: 0, hasStarted: false };

test('a new gesture starts Jiwoo visual monologue', () => {
  assert.equal(selectVisualMonologueTurn(base), 'motion');
  assert.equal(selectVisualMonologueTurn({ ...base, reactedMotionAt: now - 1_000, hasStarted: true }), 'followup');
  assert.equal(selectVisualMonologueTurn({ ...base, reactedMotionAt: now - 1_000, hasStarted: false }), null);
});
test('Jiwoo stays quiet while the user speaks and until they finish', () => {
  assert.equal(selectVisualMonologueTurn({ ...base, lastSpeechAt: now - 1_000 }), null);
  assert.equal(selectVisualMonologueTurn({ ...base, lastSpeechAt: now - 4_100 }), 'motion');
});
test('visual monologue pauses when movement stops or new calls are too close', () => {
  assert.equal(selectVisualMonologueTurn({ ...base, lastMotionAt: 0 }), null);
  assert.equal(selectVisualMonologueTurn({ ...base, lastMotionAt: now - 24_001 }), null);
  assert.equal(selectVisualMonologueTurn({ ...base, lastRequestAt: now - 2_000 }), null);
  assert.equal(selectVisualMonologueTurn({ ...base, lastRequestAt: now - 5_000 }), 'motion');
});

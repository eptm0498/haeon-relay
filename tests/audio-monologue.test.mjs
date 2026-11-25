import test from "node:test";
import assert from "node:assert/strict";
import {selectMutedAudioTurn} from "../lib/dokyeong/audio-monologue.ts";
const base={now:100000,lastRequestAt:0,hasStarted:false,microphoneMuted:true,videoOn:false,cameraOn:false};

test("muting an audio call lets Jiwoo start speaking without any camera frame",()=>{
  assert.equal(selectMutedAudioTurn(base),"start");
});
test("each audio monologue can continue after the cooldown, without requiring user speech",()=>{
  assert.equal(selectMutedAudioTurn({...base,hasStarted:true,lastRequestAt:91000}),"followup");
  assert.equal(selectMutedAudioTurn({...base,hasStarted:true,lastRequestAt:94000}),null);
});
test("unmuting, video selection, or an active camera prevents double monologue scheduling",()=>{
  assert.equal(selectMutedAudioTurn({...base,microphoneMuted:false}),null);
  assert.equal(selectMutedAudioTurn({...base,videoOn:true}),null);
  assert.equal(selectMutedAudioTurn({...base,cameraOn:true}),null);
});

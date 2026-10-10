import test from 'node:test';
import assert from 'node:assert/strict';
import {validMessageSessionSettings,shortMessagePrompt,parseShortMessage} from '../lib/dokyeong/message-session.ts';

test('accepts 30 messages in 30 minutes and rejects invalid or excessive rates',()=>{
 for(const [minutes,count] of [[30,30],[1,1],[1,2],[180,120]])assert.equal(validMessageSessionSettings(minutes,count),true);
 for(const [minutes,count] of [[0,30],[181,30],[30,0],[30,121],[1,3],[1.5,1],[30,1.5],['30',30],[NaN,1],[30,null]])assert.equal(validMessageSessionSettings(minutes,count),false);
});
test('keeps complete short sentences and refuses empty or long outputs',()=>{
 assert.equal(parseShortMessage({text:'  코코랑 산책하니 좋겠다! 그쪽은 날씨 어때?  '}),'코코랑 산책하니 좋겠다!');
 assert.equal(parseShortMessage({text:'그냥\n네 생각 좀 했어'}),'그냥 네 생각 좀 했어');
 assert.equal(parseShortMessage({text:'오 그래?'}),'오 그래?');
 for(const value of [null,{}, {text:42},{text:' '},{text:'가'.repeat(81)}])assert.throws(()=>parseShortMessage(value));
});
test('unanswered conversation continues and newest corrections remain last in context',()=>{
 const prompt=shortMessagePrompt({characterPrompt:'도경의 친근한 반말',time:'지금 오후 4시',routine:'주말 9~21시 출근',situation:'쉬는 중',memory:'강아지 이름은 모모',sent:3,total:30,context:'캐릭터: 모모랑 산책했어?\n사용자: 이름은 코코야. 지금 코코랑 산책 중이야.'});
 assert.ok(prompt.includes('답장이 없어도 자연스럽게 이야기를 이어가'));
 assert.ok(prompt.includes('새로운 사용자 답변·정정이 있으면 반드시 반영'));
 assert.ok(prompt.includes('딱 한 문장 또는 몇 단어'));
 assert.ok(prompt.includes('사진 제안을 반복하지 마'));
 assert.ok(prompt.endsWith('사용자: 이름은 코코야. 지금 코코랑 산책 중이야.'));
});

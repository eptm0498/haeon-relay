import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRoleplay} from '../lib/rp/format.ts';
import {characterFields,characterPayload} from '../lib/rp/character-fields.ts';

test('one scene sentence, subsequent dialogue, and no extra scene narration',()=>{
 assert.equal(formatRoleplay('*그는 창문을 열었다. 바람이 불었다.*\n늦었네.\n*의자에 앉는다.*\n들어와.'),'*그는 창문을 열었다.*\n늦었네.\n\n들어와.');
 assert.equal(formatRoleplay('왜 그렇게 쳐다봐.'),'왜 그렇게 쳐다봐.');
});

test('legacy fields fold into the editor without discarding settings',()=>{
 const old={name:'도경',age:'28',appearance:'검은 눈',body:'큰 키',hair:'짧은 머리',personality:'차분함',description:'친구',speech:'반말',world:'현대',secrets:'비밀',scenario:'거실',opening:'왔어?'};
 const fields=characterFields(old);
 assert.match(fields.appearance,/큰 키.*\n헤어스타일: 짧은 머리/s);
 assert.match(fields.personality,/친구.*\n말투: 반말/s);
 assert.equal(fields.opening,'*거실*\n왔어?');
 assert.equal(characterPayload(fields).gender,'남성');
});

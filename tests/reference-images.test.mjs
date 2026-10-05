import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReferences,identityReferences,emptyReferences} from '../lib/dokyeong/reference-images.ts';
const photo=(letter)=>'data:image/jpeg;base64,'+letter.repeat(48);
test('preserves ordered face and body masters; excludes the generated profile',()=>{
 const refs={face:[photo('A'),photo('B')],body:[photo('C'),photo('D')]};
 assert.deepEqual(parseReferences(refs),refs);
 assert.deepEqual(identityReferences(refs,photo('E')), [
  {url:refs.face[0],kind:'face'},{url:refs.face[1],kind:'face'},
  {url:refs.body[0],kind:'body'},{url:refs.body[1],kind:'body'},
 ]);
});
test('only uses the legacy avatar if no master references exist',()=>{
 assert.deepEqual(identityReferences(emptyReferences(),photo('A')),[{url:photo('A'),kind:'profile'}]);
 assert.deepEqual(identityReferences(emptyReferences(),null),[]);
 assert.equal(identityReferences({face:[],body:[photo('C')]},photo('A'))[0].kind,'body');
});
test('rejects oversized, malformed and excessive reference files',()=>{
 for (const value of [null,{face:[],body:null},{face:[photo('A'),photo('B'),photo('C')],body:[]},
  {face:['https://untrusted.invalid/photo.jpg'],body:[]},{face:['data:image/jpeg;base64,'+'A'.repeat(600000)],body:[]}]) assert.equal(parseReferences(value),null);
});

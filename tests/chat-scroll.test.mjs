import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function chat() {
 const slots=[],effects=[],observers=[];let cursor=0,result;
 const react={
  useRef:initial=>{const i=cursor++;return slots[i]??= {current:initial};},
  useState:initial=>{const i=cursor++;slots[i]??=initial;return [slots[i],value=>slots[i]=value];},
  useCallback:(fn,deps)=>{const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={fn,deps};return slots[i].fn;},
  useLayoutEffect:(fn,deps)=>{const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j])){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=fn());}},
 };
 const exports={};
 class Observer {constructor(fn){this.fn=fn;this.active=true;observers.push(this);}observe(){}disconnect(){this.active=false;}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/dokyeong-live/useChatScroll.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>react,ResizeObserver:Observer});
 const area={scrollHeight:1600,scrollTop:0,clientHeight:400,scrollTo({top}){this.scrollTop=Math.max(0,Math.min(top,this.scrollHeight-this.clientHeight));}};
 const messages=[];let args=[true,'one',true,messages,''];
 function render(next=args){args=next;cursor=0;result=exports.useChatScroll(...args);result.scrollRef.current=args[0]?area:null;result.contentRef.current=args[0]?{}:null;effects.splice(0).forEach(fn=>fn());return result;}
 return {area,render,get result(){return result;},resize(){observers.filter(o=>o.active).forEach(o=>o.fn());},args};
}
test('opening and reopening the same chat always scrolls to newest',()=>{
 const c=chat();c.render();assert.equal(c.area.scrollTop,1200);
 c.area.scrollTop=100;c.result.onScroll();assert.equal(c.render().showLatest,true);
 c.render([false,'one',true,c.args[3],'']);c.area.scrollTop=0;
 c.render([true,'one',true,c.args[3],'']);assert.equal(c.area.scrollTop,1200);assert.equal(c.render().showLatest,false);
});
test('asynchronous history hydration and changing characters jump to newest',()=>{
 const c=chat();c.area.scrollHeight=400;c.render([true,'one',false,[],'']);
 c.area.scrollHeight=2000;c.render([true,'one',true,[1,2,3],'']);assert.equal(c.area.scrollTop,1600);
 c.area.scrollTop=0;c.result.onScroll();c.render([true,'two',true,[4],'']);assert.equal(c.area.scrollTop,1600);
});
test('history readers are not dragged down by incoming messages; arrow jumps once',()=>{
 const c=chat();c.render();c.area.scrollTop=100;c.result.onScroll();
 c.area.scrollHeight=2000;c.render([true,'one',true,[1],'']);c.resize();assert.equal(c.area.scrollTop,100);assert.equal(c.render().showLatest,true);
 c.result.goLatest();assert.equal(c.area.scrollTop,1600);assert.equal(c.render().showLatest,false);
});
test('loaded photos and keyboard resizing keep newest visible when bottom pinned',()=>{
 const c=chat();c.render();c.area.scrollHeight=2300;c.resize();assert.equal(c.area.scrollTop,1900);
 c.area.clientHeight=200;c.resize();assert.equal(c.area.scrollTop,2100);
 c.area.scrollTop=0;c.result.onScroll();c.area.scrollHeight=2400;c.resize();assert.equal(c.area.scrollTop,0);
});
test('latest button is accessible and anchored above the composer',()=>{
 const page=fs.readFileSync(new URL('../app/dokyeong-live/page.tsx',import.meta.url),'utf8');
 assert.match(page,/chatScroll.showLatest && <button/);assert.match(page,/aria-label="최신 메시지로 이동"/);
 assert.ok(page.indexOf('className={styles.latestButton}')<page.indexOf('<form onSubmit={submitText}'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function gestures({enabled=true,chat=true,navigates=true}={}) {
 const events=new Map(),windowEvents=new Map();let cleanup;let backs=0;
 const element={addEventListener:(name,fn,options)=>events.set(name,{fn,options}),removeEventListener:name=>events.delete(name)};
 const window={history:{state:{characterLive:chat?'chat':'list'}},addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)};
 class Element {constructor(interactive=false){this.interactive=interactive;}closest(){return this.interactive?this:null;}}
 const react={useRef:value=>({current:value}),useEffect:fn=>cleanup=fn()};
 const exports={};
 const source=fs.readFileSync(new URL('../app/dokyeong-live/useBackSwipe.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>react,window,Element});
 exports.useBackSwipe({current:element},()=>{backs++;return navigates;},enabled);
 const fire=(name,x=10,y=100,extras={})=>{
  const e={touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],target:new Element(),cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extras};
  events.get(name)?.fn(e);return e;
 };
 return {events,windowEvents,window,Element,fire,cleanup:()=>cleanup?.(),get backs(){return backs;}};
}
test('edge swipe cancels Safari navigation at touchstart and goes back exactly once',()=>{
 const g=gestures();assert.equal(g.events.get('touchstart').options.passive,false);
 const start=g.fire('touchstart');assert.equal(start.defaultPrevented,true);
 // Browser default navigation runs only if touchstart was not cancelled.
 let nativeBacks=0;if(!start.defaultPrevented)nativeBacks++;
 g.fire('touchend',140);g.fire('touchend',140);g.fire('touchstart');g.fire('touchend',140);
 assert.equal(g.backs+nativeBacks,1);
});
test('a native pop, a cancelled gesture, or vertical scrolling cannot trigger another back',()=>{
 for(const interrupt of ['popstate','touchcancel','vertical']){
  const g=gestures();g.fire('touchstart');
  if(interrupt==='popstate'){g.window.history.state={characterLive:'list'};g.windowEvents.get('popstate')();}
  else if(interrupt==='vertical')g.fire('touchmove',15,170);
  else g.fire('touchcancel');
  g.fire('touchend',140);assert.equal(g.backs,0,interrupt);
 }
});
test('ordinary controls, non-edge touches, uncancellable events and multiple fingers remain untouched',()=>{
 for(const kind of ['interactive','uncancellable','multiple']){
  const g=gestures();
  const extras=kind==='interactive'?{target:new g.Element(true)}:kind==='uncancellable'?{cancelable:false}:{touches:[{clientX:10,clientY:100},{clientX:20,clientY:100}]};
  assert.equal(g.fire('touchstart',10,100,extras).defaultPrevented,false);g.fire('touchend',140);assert.equal(g.backs,0);
 }
 const g=gestures();assert.equal(g.fire('touchstart',100).defaultPrevented,false);g.fire('touchend',240);assert.equal(g.backs,0);
});
test('closing settings without navigating keeps the next swipe available',()=>{
 const g=gestures({navigates:false});
 g.fire('touchstart');g.fire('touchend',140);g.fire('touchstart');g.fire('touchend',140);
 assert.equal(g.backs,2);
});
test('list view has no custom back and listeners are removed on leaving chat',()=>{
 const disabled=gestures({enabled:false});assert.equal(disabled.events.size,0);
 const g=gestures({chat:false});g.fire('touchstart');g.fire('touchend',140);assert.equal(g.backs,0);
 g.cleanup();assert.equal(g.events.size,0);assert.equal(g.windowEvents.size,0);
 const page=fs.readFileSync(new URL('../app/dokyeong-live/page.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(page,/onTouchEnd=/);assert.match(page,/useBackSwipe\(swipeSurface,goBack,view==='chat'\)/);
});

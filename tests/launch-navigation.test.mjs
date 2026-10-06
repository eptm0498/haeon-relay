import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../app/dokyeong-live/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const effects=[];
function walk(node){
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')effects.push(node.arguments[0].getText(ast));
 ts.forEachChild(node,walk);
}
walk(ast);
const startup=effects.find(text=>text.includes('Consume notification intent once'));
const delivery=effects.find(text=>text.includes('!pendingConversation'));
const id='55af4088-3e3c-4da8-a45a-1f6bbb69c57f';
function harness(search,authenticated=false,characters=[]){
 const listeners={},routes=[],opened=[];
 const context={URLSearchParams,status:{authenticated},characters,pendingConversation:null,running:{current:false},
  window:{location:{search},history:{replaceState:(state,_,url)=>routes.push({state,url})}},
  navigator:{serviceWorker:{addEventListener:(_,fn)=>listeners.message=fn,removeEventListener:()=>{}}},
  document:{hidden:false,addEventListener:(_,fn)=>listeners.visibility=fn,removeEventListener:()=>{}},
  setPendingConversation:value=>context.pendingConversation=value,setView:value=>context.view=value,setSettingsOpen:()=>{},
  openConversation:value=>opened.push(value)};
 function run(effect){return vm.runInNewContext(ts.transpileModule(`(${effect})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);}
 run(startup);return {context,listeners,routes,opened,deliver:()=>run(delivery)};
}
test('normal launch ignores a previous chat URL and starts with the list',()=>{
 assert.match(source,/\[view, setView\] = useState<AppView>\("list"\)/);
 const app=harness('?character='+id,true,[{id}]);app.deliver();
 assert.equal(app.context.pendingConversation,null);assert.deepEqual(app.opened,[]);
 assert.equal(app.routes[0].url,'/dokyeong-live');assert.equal(app.routes[0].state.characterLive,'list');
 assert.match(source,/\(view === "list" \|\| !activeCharacter\) && status\?\.authenticated !== false/);
 assert.match(source,/historyReady && showMessages && !messages.length/);
});
test('cold notification intent survives authentication and character loading, then is consumed once',()=>{
 const app=harness('?notification=1&character='+id);app.deliver();assert.equal(app.context.pendingConversation,id);
 app.context.status.authenticated=true;app.deliver();assert.deepEqual(app.opened,[]);
 app.context.characters=[{id}];app.deliver();app.deliver();assert.deepEqual(app.opened,[id]);
 assert.equal(app.context.pendingConversation,null);assert.equal(app.routes[0].url,'/dokyeong-live');
});
test('warm notification arriving before character loading is queued; ordinary resume opens list',()=>{
 const app=harness('',true);app.listeners.message({data:{type:'OPEN_CHARACTER',characterId:id}});
 app.deliver();assert.equal(app.context.pendingConversation,id);
 app.context.characters=[{id}];app.deliver();assert.deepEqual(app.opened,[id]);
 app.context.document.hidden=true;app.listeners.visibility();assert.equal(app.context.view,'list');
 assert.equal(app.routes.at(-1).url,'/dokyeong-live');
});
test('service worker uses explicit cold notification intent and focuses before warm delivery',async()=>{
 const handlers={},actions=[];let pending;
 const self={addEventListener:(name,fn)=>handlers[name]=fn,clients:{matchAll:async()=>[],openWindow:async url=>actions.push(url)}};
 vm.runInNewContext(fs.readFileSync(new URL('../public/dokyeong-sw.js',import.meta.url),'utf8'),{self,URL,encodeURIComponent});
 const click=()=>handlers.notificationclick({notification:{close(){},data:{characterId:id}},waitUntil:promise=>pending=promise});
 click();await pending;assert.equal(actions.pop(),'/dokyeong-live?notification=1&character='+id);
 self.clients.matchAll=async()=>[{url:'https://example.com/dokyeong-live',focus:async()=>actions.push('focus'),postMessage:()=>actions.push('message')}];
 click();await pending;assert.deepEqual(actions,['focus','message']);
});

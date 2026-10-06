import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('push shows LIVE notification and opens the matching character',async()=>{
 const handlers={},notifications=[],opened=[],posted=[],badges=[];let promise;
 const context={self:{addEventListener:(name,fn)=>handlers[name]=fn,navigator:{setAppBadge:async n=>badges.push(n)},registration:{showNotification:async(title,options)=>notifications.push({title,options})},clients:{matchAll:async()=>[{url:'https://example.com/dokyeong-live',focus:async()=>{},postMessage:m=>posted.push(m)}],openWindow:async url=>opened.push(url)}},URL,Promise,Number};
 vm.runInNewContext(readFileSync(new URL('../public/dokyeong-sw.js',import.meta.url),'utf8'),context);
 const id='55af4088-3e3c-4da8-a45a-1f6bbb69c57f';handlers.push({data:{json:()=>({title:'온유',body:'형, 오늘 어땠어?',characterId:id,messageId:'test',unreadCount:3})},waitUntil:p=>promise=p});await promise;
 assert.equal(notifications[0].title,'온유');assert.equal(notifications[0].options.icon,'/live-chat-icon-192.png');assert.equal(notifications[0].options.body,'형, 오늘 어땠어?');assert.equal(badges[0],3);
 handlers.notificationclick({notification:{close:()=>{},data:{characterId:id}},waitUntil:p=>promise=p});await promise;assert.equal(posted.at(-1).type,'OPEN_CHARACTER');assert.equal(posted.at(-1).characterId,id);assert.equal(opened.length,0);
 context.self.clients.matchAll=async()=>[];handlers.notificationclick({notification:{close:()=>{},data:{characterId:id}},waitUntil:p=>promise=p});await promise;assert.equal(opened[0],'/dokyeong-live?notification=1&character='+id);
});

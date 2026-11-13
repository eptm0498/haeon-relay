const CACHE = "dokyeong-live-shell-v9";
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/dokyeong-live", "/live-chat-icon-192.png"]))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("dokyeong-live-") && key !== CACHE).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/") || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/dokyeong-live")));
});

self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 if(!data||typeof data.body!=='string'||typeof data.characterId!=='string')return;
 if(data.type==='INCOMING_CALL'){
  if(!/^[a-f0-9-]{36}$/i.test(data.callId||''))return;
  event.waitUntil(Promise.all([
   self.registration.showNotification(data.title||'지우',{body:data.body,icon:'/live-chat-icon-192.png',tag:data.messageId,renotify:true,vibrate:[220,120,220],data:{characterId:data.characterId,callId:data.callId}}),
   self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)if(client.visibilityState==='visible')client.postMessage({type:'INCOMING_CALL',callId:data.callId});})
  ]));
  return;
 }
 event.waitUntil(Promise.all([
  typeof self.navigator.setAppBadge==='function'?self.navigator.setAppBadge(Number(data.unreadCount)||1).catch(()=>{}):Promise.resolve(),
  self.registration.showNotification(data.title||'LIVE',{body:data.body,icon:'/live-chat-icon-192.png',badge:'/live-chat-icon-192.png',tag:data.messageId||'live',renotify:true,data:{characterId:data.characterId}}),
  self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({type:'CHARACTER_MESSAGE',characterId:data.characterId});})
 ]));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const id=event.notification.data?.characterId;
 if(!/^[a-f0-9-]{36}$/i.test(id||''))return;
 const callId=event.notification.data?.callId;
 const incoming=/^[a-f0-9-]{36}$/i.test(callId||'');
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  for(const client of clients){if(new URL(client.url).pathname.startsWith('/dokyeong-live')){await client.focus();client.postMessage(incoming?{type:'INCOMING_CALL',callId}:{type:'OPEN_CHARACTER',characterId:id});return;}}
  await self.clients.openWindow(incoming?'/dokyeong-live?call='+encodeURIComponent(callId):'/dokyeong-live?notification=1&character='+encodeURIComponent(id));
 }));
});

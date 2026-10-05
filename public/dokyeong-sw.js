const CACHE = "dokyeong-live-shell-v5";
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/dokyeong-live", "/dokyeong-icon.svg"]))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("dokyeong-live-") && key !== CACHE).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/") || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/dokyeong-live")));
});

self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 if(!data||typeof data.body!=='string'||typeof data.characterId!=='string')return;
 event.waitUntil(Promise.all([
  self.registration.showNotification(data.title||'캐릭터라이브',{body:data.body,icon:'/dokyeong-icon-192.png',badge:'/dokyeong-icon-192.png',tag:data.messageId||'character-live',data:{characterId:data.characterId}}),
  self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({type:'CHARACTER_MESSAGE',characterId:data.characterId});})
 ]));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const id=event.notification.data?.characterId;
 if(!/^[a-f0-9-]{36}$/i.test(id||''))return;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  for(const client of clients){if(new URL(client.url).pathname.startsWith('/dokyeong-live')){await client.focus();client.postMessage({type:'OPEN_CHARACTER',characterId:id});return;}}
  await self.clients.openWindow('/dokyeong-live?character='+encodeURIComponent(id));
 }));
});

const CACHE = "dokyeong-live-shell-v10";
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
const CHAT_INTENT_CACHE = "live-notification-navigation-v1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function openNotification(characterId, callId) {
 const incoming = UUID.test(callId || "");
 const tick = Date.now();
 const tap = incoming ? "" : tick + "-" + crypto.randomUUID();
 const destination = incoming
  ? "/dokyeong-live?call=" + encodeURIComponent(callId)
  : "/dokyeong-live?notification=1&character=" + encodeURIComponent(characterId) + "&tap=" + tap;
 const message = incoming ? {type:"INCOMING_CALL", callId} : {type:"OPEN_CHARACTER", characterId, tap};
 if (!incoming) {
  // A suspended or newly launched app may not have a message listener yet.
  try {
   const cache = await caches.open(CHAT_INTENT_CACHE);
   const key = new URL("/dokyeong-live/_notification-intent?tap=" + tap, self.location.origin);
   await cache.put(key.href, new Response(JSON.stringify(message)));
   const keys = await cache.keys();
   await Promise.all(keys.map(request => {
    const stamp = Number(new URL(request.url).searchParams.get("tap")?.split("-")[0]);
    return stamp < tick - 120_000 ? cache.delete(request) : undefined;
   }));
  } catch {
   // URL and postMessage still work when the browser denies cache storage.
  }
 }

 try {
  const clients = await self.clients.matchAll({type:"window", includeUncontrolled:true});
  for (const client of clients) {
   if (new URL(client.url).pathname.replace(/\/$/, "") !== "/dokyeong-live") continue;
   try {
    await client.focus();
    client.postMessage(message);
    return;
   } catch {
    // Try another window, then open the explicit target.
   }
  }
 } catch {}
 await self.clients.openWindow(destination);
}

self.addEventListener("notificationclick", event => {
 event.notification.close();
 const data = event.notification.data;
 if (!UUID.test(data?.characterId || "")) return;
 event.waitUntil(openNotification(data.characterId, data.callId));
});

export function validSubscription(value:unknown):boolean {
 if(!value||typeof value!=='object')return false;
 const p=value as {endpoint?:string;keys?:{p256dh?:string;auth?:string}};
 try {
  const u=new URL(p.endpoint||'');
  const trusted=u.hostname==='fcm.googleapis.com'||u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname.endsWith('.notify.windows.com');
  return trusted && u.protocol==='https:' && !u.username && !u.password && !u.port && (p.endpoint||'').length<=2048 && /^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p.keys?.p256dh||'') && /^[A-Za-z0-9_-]{20,30}={0,2}$/.test(p.keys?.auth||'');
 }catch{return false;}
}

import webpush from 'web-push';
import {serverRpc} from './memory';
export {validSubscription} from "./push-subscription";
export async function deliverPushJobs() {
 const publicKey=process.env.LIVE_PUSH_PUBLIC_KEY,privateKey=process.env.LIVE_PUSH_PRIVATE_KEY;
 if(!publicKey||!privateKey)return 0;
 webpush.setVapidDetails('mailto:eptm0498@gmail.com',publicKey,privateKey);
 const jobs=await serverRpc<Array<{id:string;endpoint:string;keys:{p256dh:string;auth:string};payload:{type?:string;expiresAt?:number}}>>('live_companion_work',{action:'push_jobs'});
 let delivered=0;
 for(let offset=0;offset<jobs.length;offset+=5){
  await Promise.all(jobs.slice(offset,offset+5).map(async job=>{
   const incomingCall = job.payload.type === 'INCOMING_CALL';
   const ttl = incomingCall ? Math.floor(((job.payload.expiresAt ?? 0) - Date.now()) / 1000) : 43200;
   let ok=ttl<=0,gone=false;
   try {
    if(ttl>0){
     await webpush.sendNotification({endpoint:job.endpoint,keys:job.keys},JSON.stringify(job.payload),{TTL:ttl,urgency:incomingCall?'high':'normal',timeout:10000});
     ok=true;delivered++;
    }
   }
   catch(error){gone=[404,410].includes(Number((error as {statusCode?:number}).statusCode));}
   await serverRpc('live_companion_work',{action:'push_ack',data:{id:job.id,endpoint:job.endpoint,ok,gone}});
  }));
 }
 return delivered;
}

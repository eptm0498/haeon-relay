import {NextRequest} from 'next/server';
import {authenticated,noStore,sameOrigin,unauthorized} from '@/lib/dokyeong/auth';
import {serverRpc} from '@/lib/dokyeong/memory';
import {after} from 'next/server';
import {deliverPushJobs} from '@/lib/dokyeong/push';
import {validSubscription} from '@/lib/dokyeong/push';
import {runMessageSessionWorker} from '@/lib/dokyeong/message-session-worker';
import {validMessageSessionSettings,MESSAGE_SESSION_SETTINGS_ERROR} from '@/lib/dokyeong/message-session';
export const runtime='nodejs';
export const maxDuration=180;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function POST(request:NextRequest){
 if(!authenticated(request))return unauthorized();
 if(!sameOrigin(request))return new Response(null,{status:403,headers:noStore});
 try{
  const raw=await request.text();if(raw.length>6000)return new Response(null,{status:413});
  const body=JSON.parse(raw);
  if(!uuid.test(body.deviceId||'')||!['status','presence','preference','subscribe','unsubscribe','test','session_start','session_stop'].includes(body.action)||body.characterId && !uuid.test(body.characterId))return new Response(null,{status:400});
  if(['session_start','session_stop'].includes(body.action)){
   if(!body.characterId||!uuid.test(body.data?.sessionId||''))return Response.json({error:'캐릭터와 예약 설정을 확인해 줘.'},{status:400,headers:noStore});
   if(body.action==='session_start'&&!validMessageSessionSettings(body.data?.minutes,body.data?.count))return Response.json({error:MESSAGE_SESSION_SETTINGS_ERROR},{status:400,headers:noStore});
   await serverRpc('live_message_session_work',{action:body.action==='session_start'?'start':'stop',target_character:body.characterId,data:body.data});
   if(body.action==='session_start')after(async()=>{await runMessageSessionWorker().catch(()=>{});});
   const result=await serverRpc<object>('live_companion_work',{action:'status',device_id:body.deviceId});
   return Response.json({...result,publicKey:process.env.LIVE_PUSH_PUBLIC_KEY||''},{headers:noStore});
  }
  if(body.action==='subscribe' && !validSubscription(body.data))return Response.json({error:'알림 등록 정보를 확인해 줘.'},{status:400,headers:noStore});
  if(body.action==='preference' && (typeof body.data?.enabled!=='boolean'||!body.characterId))return new Response(null,{status:400});
  if(body.action==='test'){const result=await serverRpc('live_test_push',{device_id:body.deviceId,target_character:body.characterId||null});after(async()=>{await deliverPushJobs();});return Response.json(result,{headers:noStore});}
  const result=await serverRpc<object>('live_companion_work',{action:body.action,target_character:body.characterId||null,device_id:body.deviceId,data:body.data||{}});
  return Response.json({...result,publicKey:process.env.LIVE_PUSH_PUBLIC_KEY||''},{headers:noStore});
 }catch(error){return Response.json({error:(error as {code?:string}).code==='PT409'?'이미 진행 중인 예약이 있어. 중단한 뒤 다시 시작해 줘.':'선톡 설정을 불러오지 못했어.'},{status:(error as {code?:string}).code==='PT409'?409:503,headers:noStore});}
}

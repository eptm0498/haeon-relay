import {NextRequest} from 'next/server';
import {authenticated,noStore,sameOrigin,unauthorized} from '@/lib/dokyeong/auth';
import {serverRpc} from '@/lib/dokyeong/memory';
import {after} from 'next/server';
import {deliverPushJobs} from '@/lib/dokyeong/push';
import {validSubscription} from '@/lib/dokyeong/push';
export const runtime='nodejs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function POST(request:NextRequest){
 if(!authenticated(request))return unauthorized();
 if(!sameOrigin(request))return new Response(null,{status:403,headers:noStore});
 try{
  const raw=await request.text();if(raw.length>6000)return new Response(null,{status:413});
  const body=JSON.parse(raw);
  if(!uuid.test(body.deviceId||'')||!['status','presence','preference','subscribe','unsubscribe','test'].includes(body.action)||body.characterId && !uuid.test(body.characterId))return new Response(null,{status:400});
  if(body.action==='subscribe' && !validSubscription(body.data))return Response.json({error:'알림 등록 정보를 확인해 줘.'},{status:400,headers:noStore});
  if(body.action==='preference' && (typeof body.data?.enabled!=='boolean'||!body.characterId))return new Response(null,{status:400});
  if(body.action==='test'){const result=await serverRpc('live_test_push',{device_id:body.deviceId,target_character:body.characterId||null});after(async()=>{await deliverPushJobs();});return Response.json(result,{headers:noStore});}
  const result=await serverRpc<object>('live_companion_work',{action:body.action,target_character:body.characterId||null,device_id:body.deviceId,data:body.data||{}});
  return Response.json({...result,publicKey:process.env.LIVE_PUSH_PUBLIC_KEY||''},{headers:noStore});
 }catch{return Response.json({error:'선톡 설정을 불러오지 못했어.'},{status:503,headers:noStore});}
}

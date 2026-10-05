import {after,NextRequest} from 'next/server';
import {authenticated,noStore,sameOrigin,unauthorized} from '@/lib/dokyeong/auth';
import {serverRpc} from '@/lib/dokyeong/memory';
import {runImageJob} from '@/lib/dokyeong/image-jobs';
export const runtime='nodejs';export const maxDuration=300;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function GET(request:NextRequest){
 if(!authenticated(request))return unauthorized();
 const id=request.nextUrl.searchParams.get('id'),character=request.nextUrl.searchParams.get('characterId');
 if(!uuid.test(id||character||''))return Response.json({error:'사진 요청을 확인해 줘.'},{status:400,headers:noStore});
 try{return Response.json(await serverRpc('live_image_work',id?{action:'read',target_job:id}:{action:'list',target_character:character}),{headers:noStore});}catch{return Response.json({error:'사진 상태를 불러오지 못했어.'},{status:503,headers:noStore});}
}
export async function POST(request:NextRequest){
 if(!authenticated(request))return unauthorized();if(!sameOrigin(request))return new Response(null,{status:403});
 try{
  const raw=await request.text();if(raw.length>12000)return new Response(null,{status:413});const body=JSON.parse(raw);
  if(body.action==='retry'){
   if(!uuid.test(body.id||''))return new Response(null,{status:400});
   const job=await serverRpc('live_image_work',{action:'retry',target_job:body.id});if(!job)return Response.json({error:'이 요청은 더 이상 재시도할 수 없어.'},{status:409,headers:noStore});after(()=>runImageJob(body.id));return Response.json({job},{status:202,headers:noStore});
  }
  if(!uuid.test(body.characterId||'')||!uuid.test(body.requestId||'')||typeof body.text!=='string'||!body.text.trim()||body.text.length>1500||typeof body.scene!=='string'||!body.scene.trim()||body.scene.length>1800||body.sourceMessageId&&!/^[a-zA-Z0-9:_-]{1,120}$/.test(body.sourceMessageId))return Response.json({error:'사진 요청을 확인해 줘.'},{status:400,headers:noStore});
  const job=await serverRpc('live_image_work',{action:'create',target_job:body.requestId,target_character:body.characterId,data:{text:body.text,scene:body.scene,context:typeof body.context==='string'?body.context.slice(-6000):'',sourceMessageId:body.sourceMessageId||null}});
  after(()=>runImageJob(body.requestId));return Response.json({job},{status:202,headers:noStore});
 }catch(error){return Response.json({error:error instanceof Error&&error.message.includes('IMAGE_DAILY_LIMIT')?'오늘 설정한 사진 생성 한도에 도달했어. 대화 설정에서 한도를 확인해 줘.':'사진 요청을 저장하지 못했어. 다시 시도해 줘.'},{status:503,headers:noStore});}
}

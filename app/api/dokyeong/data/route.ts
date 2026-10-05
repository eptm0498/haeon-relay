import {NextRequest} from 'next/server';
import {authenticated,noStore,sameOrigin,unauthorized} from '@/lib/dokyeong/auth';
import {serverRpc} from '@/lib/dokyeong/memory';
export const runtime='nodejs';
const uuid=/^[a-f0-9-]{36}$/i;
export async function POST(request:NextRequest){
 if(!authenticated(request))return unauthorized();if(!sameOrigin(request))return new Response(null,{status:403});
 try{
  const raw=await request.text();if(raw.length>15000)return new Response(null,{status:413});const body=JSON.parse(raw);
  if(!['settings','settings_save','memory','memory_save','archive','search','export'].includes(body.action)||body.characterId&&!uuid.test(body.characterId)||!['settings','settings_save'].includes(body.action)&&!uuid.test(body.characterId||''))return new Response(null,{status:400});
  if(body.data?.before!==undefined&&(!Number.isSafeInteger(body.data.before)||body.data.before<1))return new Response(null,{status:400});
  if(body.action==='memory')return Response.json(await serverRpc('live_memory_work',{action:'read',target_character:body.characterId}),{headers:noStore});
  return Response.json(await serverRpc('live_data_work',{action:body.action,target_character:body.characterId||null,data:body.data||{}}),{headers:noStore});
 }catch(error){return Response.json({error:error instanceof Error&&error.message==='VERSION_CONFLICT'?'다른 기기에서 바뀌었어. 다시 불러와 줘.':'설정을 저장하거나 불러오지 못했어.'},{status:503,headers:noStore});}
}

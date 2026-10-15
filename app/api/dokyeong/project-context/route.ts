import {NextRequest} from 'next/server';
import {authenticated,noStore,sameOrigin,unauthorized} from '@/lib/dokyeong/auth';
import {projectRpc,saveProjectSnapshot,type ProjectSnapshot} from '@/lib/dokyeong/project-context';
export const runtime='nodejs';
export const maxDuration=120;
const uuid=/^[a-f0-9-]{36}$/i;
const publicStatus=(s:ProjectSnapshot)=>({projectUrl:s.project_url,sourceUrl:s.source_url,sourceTitle:s.source_title,version:s.version,updatedAt:s.updated_at,checkedAt:s.checked_at,messageCount:s.message_count,partial:s.partial});
export async function GET(request:NextRequest) {
  if(!authenticated(request))return unauthorized();
  const id=request.nextUrl.searchParams.get('characterId')||'';
  if(!uuid.test(id))return Response.json({error:'캐릭터를 확인해 줘.'},{status:400,headers:noStore});
  try{return Response.json(publicStatus(await projectRpc<ProjectSnapshot>(id)),{headers:noStore});}
  catch{return Response.json({error:'프로젝트 연결을 불러오지 못했어.'},{status:503,headers:noStore});}
}
export async function POST(request:NextRequest) {
  if(!authenticated(request))return unauthorized();
  if(!sameOrigin(request))return Response.json({error:'요청을 확인해 줘.'},{status:403,headers:noStore});
  if(Number(request.headers.get('content-length'))>2500000)return Response.json({error:'대화 파일이 너무 커.'},{status:413,headers:noStore});
  try{
    const raw=await request.text();if(raw.length>900000)return Response.json({error:'대화가 너무 길어.'},{status:413,headers:noStore});
    const body=JSON.parse(raw);
    if(!uuid.test(body.characterId||'')||!Number.isInteger(body.version)||typeof body.sourceUrl!=='string')return Response.json({error:'연결 정보를 확인해 줘.'},{status:400,headers:noStore});
    const result=await saveProjectSnapshot(body.characterId,body);
    return Response.json(publicStatus(result),{headers:noStore});
  }catch(cause){
    const conflict=cause instanceof Error&&cause.message==='VERSION_CONFLICT';
    return Response.json({error:conflict?'다른 기기에서 먼저 업데이트했어. 최신 상태를 불러온 뒤 다시 눌러 줘.':'대화 업데이트를 완료하지 못했어. 기존 기억은 그대로 있어. 원본 대화와 연결 상태를 확인해 줘.'},{status:conflict?409:503,headers:noStore});
  }
}

import {NextRequest} from 'next/server';
import {authenticated,unauthorized} from '@/lib/dokyeong/auth';
import {serverRpc} from '@/lib/dokyeong/memory';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{characterId:string;messageId:string}>}){
 if(!authenticated(request))return unauthorized();const {characterId,messageId}=await params;
 if(!/^[a-f0-9-]{36}$/i.test(characterId)||!/^[a-zA-Z0-9:_-]{1,120}$/.test(messageId))return new Response(null,{status:400});
 const media=await serverRpc<{dataUrl:string;mimeType:string}|null>('live_data_work',{action:'media',target_character:characterId,data:{messageId}});
 if(!media)return new Response(null,{status:404});
 return new Response(Buffer.from(media.dataUrl.split(',')[1],'base64'),{headers:{'Content-Type':media.mimeType,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});
}

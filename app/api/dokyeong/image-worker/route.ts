import {timingSafeEqual} from 'node:crypto';
import {runImageJob} from '@/lib/dokyeong/image-jobs';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){
 const expected=Buffer.from('Bearer '+(process.env.LIVE_WORKER_SECRET||'')),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!process.env.LIVE_WORKER_SECRET||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response(null,{status:401});
 try{return Response.json({completed:await runImageJob()});}catch{return new Response(null,{status:503});}
}

import {timingSafeEqual} from 'node:crypto';
import {runCompanionWorker} from '@/lib/dokyeong/companion';
import {noStore} from '@/lib/dokyeong/auth';
export const runtime='nodejs';export const maxDuration=240;
export async function POST(request:Request){
 const expected=`Bearer ${process.env.LIVE_WORKER_SECRET||''}`,actual=request.headers.get('authorization')||'';
 if(!process.env.LIVE_WORKER_SECRET||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return new Response(null,{status:401,headers:noStore});
 try{return Response.json(await runCompanionWorker(),{headers:noStore});}
 catch(error){console.warn('CHARACTER_WORKER_FAILED',error instanceof Error?error.message:'unknown');return Response.json({error:'worker unavailable'},{status:503,headers:noStore});}
}

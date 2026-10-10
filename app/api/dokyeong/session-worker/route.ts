import {timingSafeEqual} from 'node:crypto';
import {runMessageSessionWorker} from '@/lib/dokyeong/message-session-worker';
import {noStore} from '@/lib/dokyeong/auth';
export const runtime='nodejs';
export const maxDuration=180;
export async function POST(request:Request) {
 const expected=Buffer.from(`Bearer ${process.env.LIVE_WORKER_SECRET||''}`),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!process.env.LIVE_WORKER_SECRET||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response(null,{status:401,headers:noStore});
 try{return Response.json(await runMessageSessionWorker(),{headers:noStore});}
 catch{console.warn('LIVE_MESSAGE_SESSION_WORKER_FAILED');return Response.json({error:'worker unavailable'},{status:503,headers:noStore});}
}

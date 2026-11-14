import {timingSafeEqual} from 'node:crypto';
import {runReplyWorker} from '@/lib/dokyeong/reply-jobs';
import {serverRpc} from '@/lib/dokyeong/memory';
import {noStore} from '@/lib/dokyeong/auth';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){
 const expected=Buffer.from(`Bearer ${process.env.LIVE_WORKER_SECRET||''}`),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!process.env.LIVE_WORKER_SECRET||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response(null,{status:401,headers:noStore});
 try{
  const missedCallTexts=await serverRpc<number>('live_send_jiwoo_missed_call_toks',{}).catch(()=>{
   console.warn('LIVE_MISSED_CALL_TEXT_RETRY');
   return 0;
  });
  return Response.json({...await runReplyWorker(),missedCallTexts},{headers:noStore});
 }
 catch{console.warn('LIVE_REPLY_WORKER_FAILED');return Response.json({error:'worker unavailable'},{status:503,headers:noStore});}
}

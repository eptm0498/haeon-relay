import {timingSafeEqual} from 'node:crypto';
import {runReplyWorker} from '@/lib/dokyeong/reply-jobs';
import {sendMissedCallFollowups} from '@/lib/dokyeong/missed-call-followup';
import {noStore} from '@/lib/dokyeong/auth';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){
 const expected=Buffer.from(`Bearer ${process.env.LIVE_WORKER_SECRET||''}`),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!process.env.LIVE_WORKER_SECRET||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response(null,{status:401,headers:noStore});
 try{
  const followups=sendMissedCallFollowups().catch(()=>{
   console.warn('LIVE_MISSED_CALL_TEXT_RETRY');
   return 0;
  });
  const [replies,missedCallTexts]=await Promise.all([runReplyWorker(),followups]);
  return Response.json({...replies,missedCallTexts},{headers:noStore});
 }
 catch{console.warn('LIVE_REPLY_WORKER_FAILED');return Response.json({error:'worker unavailable'},{status:503,headers:noStore});}
}

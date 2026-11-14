import {timingSafeEqual} from 'node:crypto';
import {runCompanionWorker} from '@/lib/dokyeong/companion';
import {runJiwooProactive} from '@/lib/dokyeong/jiwoo-proactive';
import {noStore} from '@/lib/dokyeong/auth';
export const runtime='nodejs';export const maxDuration=240;
export async function POST(request:Request){
 const expected=Buffer.from(`Bearer ${process.env.LIVE_WORKER_SECRET||''}`),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!process.env.LIVE_WORKER_SECRET||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response(null,{status:401,headers:noStore});
 const jiwoo = runJiwooProactive().catch(() => { console.warn("JIWOO_PROACTIVE_RETRY"); return null; });
 try{
  const [result, contact] = await Promise.all([runCompanionWorker(), jiwoo]);
  return Response.json({...result,sent:result.sent+Number(contact==="text"),calls:Number(contact==="call")},{headers:noStore});
 }
 catch(error){console.warn('CHARACTER_WORKER_FAILED',error instanceof Error?error.message:'unknown');return Response.json({error:'worker unavailable'},{status:503,headers:noStore});}
}

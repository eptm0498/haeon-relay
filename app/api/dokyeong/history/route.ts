import { createHash } from "node:crypto";
import { after, NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { rpc } from "@/lib/dokyeong/settings";

import { deliverReplies } from "@/lib/dokyeong/reply-jobs";
import { deliverPushJobs } from "@/lib/dokyeong/push";
import { runImageJob } from "@/lib/dokyeong/image-jobs";
import { updateMemory } from "@/lib/dokyeong/memory";
export const runtime = "nodejs";
export const maxDuration=300;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function sync(body: object) {
  const token = process.env.CHARACTER_HISTORY_KEY;
  if (!token) throw new Error("history not configured");
  return rpc("live_sync_history", {server_token: token, ...body}, 15000);
}
const failure = (error: unknown) => Response.json({
  error: error instanceof Error && error.message === "VERSION_CONFLICT"
    ? "다른 기기에서 새 대화를 시작했어. 최신 대화를 다시 불러올게."
    : "대화 동기화가 잠시 끊겼어. 연결되면 다시 저장할게.",
}, {status: error instanceof Error && error.message === "VERSION_CONFLICT" ? 409 : 503, headers:noStore});

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  try {
    const delivered=await deliverReplies();
    if(delivered.count)after(async()=>{await Promise.all([deliverPushJobs().catch(()=>0),...delivered.photos.slice(0,1).map(id=>runImageJob(id)),...delivered.characters.map(id=>updateMemory(id,1).catch(()=>0))]);});
    const versions=await rpc("live_data_work",{server_token:process.env.CHARACTER_HISTORY_KEY,action:"versions"},15000);
    const etag='"'+createHash('sha256').update(JSON.stringify(versions)).digest('hex')+'"';
    if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{...noStore,ETag:etag}});
    return Response.json(await sync({action:"read"}), {headers:{...noStore,ETag:etag}});
  }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({error:"요청을 확인해 줘."}, {status:403,headers:noStore});
  try {
    const raw = await request.text();
    if (raw.length > 3000000) return Response.json({error:"대화가 너무 커."}, {status:413,headers:noStore});
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({error:"대화 형식을 확인해 줘."}, {status:400,headers:noStore}); }
    if (!body || typeof body !== "object" || !uuid.test(body.characterId || "") || !uuid.test(body.epoch || "") ||
        !["append","import","reset"].includes(body.action) || !Array.isArray(body.messages) || body.messages.length > 40 ||
        body.messages.some((m: {id?:unknown;role?:unknown;content?:unknown;ts?:unknown;image?:{dataUrl?:unknown;mimeType?:unknown}}) =>
          !m || typeof m.id !== "string" || !/^[a-zA-Z0-9:_-]{1,120}$/.test(m.id) ||
          !["user","assistant"].includes(String(m.role)) || typeof m.content !== "string" || m.content.length > 30000 ||
          typeof m.ts !== "number" || !Number.isSafeInteger(m.ts) || m.ts < 0 ||
          m.image && (typeof m.image.dataUrl !== "string" ||
            !["image/jpeg","image/png","image/webp"].includes(String(m.image.mimeType)) || m.image.dataUrl.length > 1850000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(m.image.dataUrl) && !/^\/api\/dokyeong\/media\/[a-f0-9-]{36}\/[A-Za-z0-9:_-]{1,120}$/i.test(m.image.dataUrl))))
      return Response.json({error:"대화 형식을 확인해 줘."}, {status:400,headers:noStore});
    const messages = body.messages.map((m: {id:string;role:string;content:string;ts:number;image?:{dataUrl:string;mimeType:string}}) => ({
      id:m.id, role:m.role, content:m.content, ts:m.ts,
      ...(m.image ? {image:{dataUrl:m.image.dataUrl,mimeType:m.image.mimeType}} : {}),
    }));
    const saved=body.action==="reset" && body.keepMemory===true
      ? await rpc("live_data_work",{server_token:process.env.CHARACTER_HISTORY_KEY,action:"reset_keep_memory",target_character:body.characterId,data:{epoch:body.epoch}},15000)
      : await sync({action:body.action,target_character:body.characterId,expected_epoch:body.epoch,incoming:messages});
    if(body.action!=="reset")after(()=>updateMemory(body.characterId).catch(()=>{console.warn("CHARACTER_MEMORY_RETRY",body.characterId);}));
    return Response.json(saved,{headers:noStore});
  } catch (error) { return failure(error); }
}

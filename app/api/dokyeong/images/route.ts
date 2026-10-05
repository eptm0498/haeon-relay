import { after, NextRequest } from "next/server";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { readCharacterReferences, readLiveCharacter } from "@/lib/dokyeong/characters";
import { rpc } from "@/lib/dokyeong/settings";
import { memoryContext, updateMemory } from "@/lib/dokyeong/memory";
import { currentTimeContext } from "@/lib/dokyeong/time-context";
import { generateCharacterPhoto, ImageGenerationError } from "@/lib/dokyeong/image-generation";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  if (!sameOrigin(request)) return Response.json({error:"요청을 확인해 줘."}, {status:403,headers:noStore});
  try {
    const raw = await request.text();
    if (raw.length > 12000) return Response.json({error:"사진 요청이 너무 길어."}, {status:413,headers:noStore});
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({error:"사진 요청을 확인해 줘."}, {status:400,headers:noStore}); }
    if (!body || typeof body.text !== "string" || body.text.length > 1500 || !body.text.trim() ||
        body.scene !== undefined && (typeof body.scene !== "string" || body.scene.length>1800) ||
        typeof body.characterId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.characterId))
      return Response.json({error:"원하는 사진을 말해 줘."}, {status:400,headers:noStore});
    const key = process.env.OPENAI_API_KEY;
    const historyKey = process.env.CHARACTER_HISTORY_KEY;
    if (!key || !historyKey) return Response.json({error:"사진 생성 연결 설정이 필요해."}, {status:503,headers:noStore});
    const character = await readLiveCharacter(body.characterId);
    if (!character) return Response.json({error:"캐릭터를 찾지 못했어."}, {status:404,headers:noStore});
    // Always read the currently saved portrait; never reuse a generated face.
    const reference = character.avatar_url?.trim() || "";
    if (reference && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(reference) && !/^https?:\/\//i.test(reference))
      return Response.json({error:"프로필 사진을 읽을 수 없어. 설정에서 사진을 다시 저장해 줘."},{status:400,headers:noStore});
    const histories = await rpc<Array<{character_id:string;epoch:string}>>("live_sync_history", {server_token:historyKey,action:"read"},15000);
    const history = histories.find(h => h.character_id === character.id);
    if (!history) throw new Error("history unavailable");
    const context = typeof body.context === "string" ? body.context.slice(-6000) : "";
    const references=await readCharacterReferences(character.id);
    const generated=await generateCharacterPhoto({name:character.name,characterPrompt:character.prompt,references,avatar:reference,request:body.scene||body.text,context:currentTimeContext()+context,memory:await memoryContext(character.id),signal:request.signal});
    const {image,model}=generated;
    const message={id:crypto.randomUUID(),role:"assistant",content:"",ts:Date.now(),image,imagePrompt:body.scene||body.text};
    // Save before delivery, so a reload or device switch preserves the photo.
    await rpc("live_sync_history",{server_token:historyKey,action:"append",target_character:character.id,expected_epoch:history.epoch,incoming:[message]},15000);
    after(()=>updateMemory(character.id).catch(()=>{console.warn("CHARACTER_MEMORY_RETRY",character.id);}));
    console.log("CHARACTER_IMAGE_OK",character.id,model,"references",generated.referenceCount);
    return Response.json({message,model,referenceUsed:generated.referenceUsed,referenceCount:generated.referenceCount,faceCount:generated.faceCount,bodyCount:generated.bodyCount},{headers:noStore});
  } catch (cause) {
    if (request.signal.aborted) return new Response(null,{status:499,headers:noStore});
    console.warn("CHARACTER_IMAGE_ERROR",cause instanceof Error ? cause.name : "unknown");
    return Response.json({error:cause instanceof ImageGenerationError ? cause.message : "사진 생성이 중단됐어. 대화가 바뀌었거나 연결이 끊겼을 수 있어. 다시 요청해 줘."},{status:503,headers:noStore});
  }
}

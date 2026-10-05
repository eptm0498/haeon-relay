import { NextRequest } from "next/server";
import sharp from "sharp";
import { authenticated, noStore, sameOrigin, unauthorized } from "@/lib/dokyeong/auth";
import { readLiveCharacter } from "@/lib/dokyeong/characters";
import { rpc } from "@/lib/dokyeong/settings";
import { wantsPhoto } from "@/lib/dokyeong/photo-intent";

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
    if (!body || typeof body.text !== "string" || body.text.length > 1500 || !wantsPhoto(body.text) ||
        typeof body.characterId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.characterId))
      return Response.json({error:"원하는 사진을 말해 줘."}, {status:400,headers:noStore});
    const key = process.env.OPENAI_API_KEY;
    const historyKey = process.env.CHARACTER_HISTORY_KEY;
    if (!key || !historyKey) return Response.json({error:"사진 생성 연결 설정이 필요해."}, {status:503,headers:noStore});
    const character = await readLiveCharacter(body.characterId);
    if (!character) return Response.json({error:"캐릭터를 찾지 못했어."}, {status:404,headers:noStore});
    const histories = await rpc<Array<{character_id:string;epoch:string}>>("live_sync_history", {server_token:historyKey,action:"read"},15000);
    const history = histories.find(h => h.character_id === character.id);
    if (!history) throw new Error("history unavailable");
    const context = typeof body.context === "string" ? body.context.slice(-6000) : "";
    const prompt = `Create ONE image requested in this character chat. Follow the user's desired subject, scene, clothing, pose and style. Default to a natural realistic photo. If they ask for a selfie or a photo of you, depict the adult character ${character.name}; use the reference portrait for their identity when provided. If they ask for scenery or objects, show that subject instead. This is a generated fictional scene, not evidence of a real event. No chat bubbles, captions or interface.\nCharacter context (only use details relevant to appearance):\n${character.prompt.slice(0,6000)}\nRecent conversation (for references to previously discussed scenes):\n${context}\nUser's image request:\n${body.text}`;
    const reference = character.avatar_url?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(155000)]);
    const generate = async (model: string) => {
      const options = {model,prompt,n:1,size:"1024x1024",quality:"medium",output_format:"jpeg",output_compression:75};
      let payload: BodyInit;
      const headers: Record<string,string> = {Authorization:`Bearer ${key}`};
      if (reference) {
        const form = new FormData();
        for (const [name,value] of Object.entries(options)) form.set(name,String(value));
        form.set("image[]",new Blob([Buffer.from(reference[2],"base64")],{type:reference[1]}),"portrait."+reference[1].split("/")[1]);
        payload=form;
      } else {headers["Content-Type"]="application/json";payload=JSON.stringify(options);}
      const response = await fetch(`https://api.openai.com/v1/images/${reference ? "edits" : "generations"}`, {method:"POST",headers,body:payload,signal});
      return {response,result:await response.json()};
    };
    let model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
    let generated = await generate(model);
    // Some existing API projects do not yet expose the newer image model.
    if ([400,404].includes(generated.response.status) && /model/i.test(String(generated.result.error?.code || generated.result.error?.param || "")) && model !== "gpt-image-1.5") {
      model="gpt-image-1.5";generated=await generate(model);
    }
    if (!generated.response.ok) {
      const status = generated.response.status;
      console.warn("CHARACTER_IMAGE_FAILED",status,generated.result.error?.code || "unknown");
      const message = status===429 ? "사진 생성 사용 한도에 도달했어. 잠시 후 다시 요청해 줘." :
        /moderation|safety|content_policy/i.test(String(generated.result.error?.code || "")) ? "이 사진은 생성할 수 없어. 다른 장면으로 요청해 줘." :
        status===401 || status===403 ? "사진 생성 API 권한을 확인해야 해." : "사진을 만들지 못했어. 다시 요청해 줘.";
      return Response.json({error:message},{status:502,headers:noStore});
    }
    const encoded = generated.result.data?.[0]?.b64_json;
    if (typeof encoded !== "string") throw new Error("empty image");
    const bytes = await sharp(Buffer.from(encoded,"base64")).resize(1024,1024,{fit:"inside",withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
    const image={dataUrl:`data:image/jpeg;base64,${bytes.toString("base64")}`,mimeType:"image/jpeg"};
    if (image.dataUrl.length>1850000) throw new Error("image too large");
    const message={id:crypto.randomUUID(),role:"assistant",content:"요청한 사진이야.",ts:Date.now(),image};
    // Save before delivery, so a reload or device switch preserves the photo.
    await rpc("live_sync_history",{server_token:historyKey,action:"append",target_character:character.id,expected_epoch:history.epoch,incoming:[message]},15000);
    console.log("CHARACTER_IMAGE_OK",character.id,model,bytes.length);
    return Response.json({message,model},{headers:noStore});
  } catch (cause) {
    if (request.signal.aborted) return new Response(null,{status:499,headers:noStore});
    console.warn("CHARACTER_IMAGE_ERROR",cause instanceof Error ? cause.name : "unknown");
    return Response.json({error:"사진 생성이 중단됐어. 대화가 바뀌었거나 연결이 끊겼을 수 있어. 다시 요청해 줘."},{status:503,headers:noStore});
  }
}

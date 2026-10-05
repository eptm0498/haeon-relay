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
    // Always read the currently saved portrait; never reuse a generated face.
    const reference = character.avatar_url?.trim() || "";
    if (reference && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(reference) && !/^https?:\/\//i.test(reference))
      return Response.json({error:"프로필 사진을 읽을 수 없어. 설정에서 사진을 다시 저장해 줘."},{status:400,headers:noStore});
    const histories = await rpc<Array<{character_id:string;epoch:string}>>("live_sync_history", {server_token:historyKey,action:"read"},15000);
    const history = histories.find(h => h.character_id === character.id);
    if (!history) throw new Error("history unavailable");
    const context = typeof body.context === "string" ? body.context.slice(-6000) : "";
    const identity = reference ? `The provided image is the MASTER IDENTITY reference for ${character.name}. When the requested scene includes the character, depict exactly the same individual, not a similar-looking person. Preserve facial geometry, eye shape and spacing, eyebrows, nose, lips, jawline, hairline, apparent age, skin tone and visible body proportions. Identity has higher priority than aesthetics or textual appearance descriptions. Do not beautify, reshape the face, change ethnicity, or replace distinguishing features. Keep visible natural skin texture. If text descriptions conflict with the portrait, the portrait wins for identity. Change ONLY the scene, clothing, pose, expression, lighting and framing as requested; the portrait's original background and crop are not constraints. Do not invent hidden distinguishing features. A selfie means this same person photographing themself.` : `No portrait is provided. Use the character's appearance description consistently.`;
    const prompt = `Create ONE image requested in this character chat. Follow the user's desired subject, scene, clothing, pose and style. Default to an ordinary realistic smartphone photo: natural proportions, believable light and contact, no plastic skin, artificial glamour, exaggerated bokeh or wide-angle facial distortion. If they ask for a selfie or a photo of you, depict the adult character ${character.name}. If they specifically ask for scenery or objects without a person, show that subject instead; do not insert the character unnecessarily. This is a generated fictional scene, not evidence of a real event. No chat bubbles, captions or interface.\nIDENTITY RULES:\n${identity}\nCharacter context (use personality and scene details; do not override the reference person's identity):\n${character.prompt.slice(0,6000)}\nRecent conversation (for references to previously discussed scenes):\n${context}\nUser's image request:\n${body.text}`;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(155000)]);
    const generate = async (model: string) => {
      const options = {model,prompt,n:1,size:"1024x1024",quality:"medium",output_format:"jpeg",output_compression:75,
        ...(reference ? {images:[{image_url:reference}]} : {}),
        // GPT Image 2 always uses high input fidelity; older fallback models need it explicitly.
        ...(reference && ["gpt-image-1","gpt-image-1.5"].includes(model) ? {input_fidelity:"high"} : {}),
      };
      // JSON edits accept both uploaded data URLs and externally hosted profile images.
      const response = await fetch(`https://api.openai.com/v1/images/${reference ? "edits" : "generations"}`, {
        method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(options),signal,
      });
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
        reference && /image|url/i.test(String(generated.result.error?.param || "")) ? "프로필 사진을 읽지 못했어. 설정에서 사진을 다시 올려 줘." :
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
    console.log("CHARACTER_IMAGE_OK",character.id,model,bytes.length,"reference",!!reference);
    return Response.json({message,model,referenceUsed:!!reference},{headers:noStore});
  } catch (cause) {
    if (request.signal.aborted) return new Response(null,{status:499,headers:noStore});
    console.warn("CHARACTER_IMAGE_ERROR",cause instanceof Error ? cause.name : "unknown");
    return Response.json({error:"사진 생성이 중단됐어. 대화가 바뀌었거나 연결이 끊겼을 수 있어. 다시 요청해 줘."},{status:503,headers:noStore});
  }
}

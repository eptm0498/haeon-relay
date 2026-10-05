import sharp from "sharp";
import { identityReferences, type ReferenceImages } from "./reference-images";

export class ImageGenerationError extends Error {
  constructor(message: string) { super(message); this.name="ImageGenerationError"; }
}

export async function generateCharacterPhoto(input: {
  name:string; characterPrompt:string; references:ReferenceImages; avatar?:string|null;
  request:string; context?:string; signal:AbortSignal; profile?:boolean;
}) {
  const key=process.env.OPENAI_API_KEY;
  if (!key) throw new ImageGenerationError("사진 생성 연결 설정이 필요해.");
  const references=identityReferences(input.references,input.avatar);
  const mapping=references.map((ref,index)=>`Image ${index+1}: ${ref.kind === "face" ? "MASTER FACE: facial identity, features, hairline and skin tone" : ref.kind === "body" ? "MASTER BODY: physique, body proportions, shoulder width, torso-to-leg ratio and build; its face must not override MASTER FACE" : "identity portrait"}`).join("\n");
  const prompt=`Create ONE image for the adult character ${input.name}. This is a generated fictional scene, not evidence of a real event.\nREFERENCE ROLES:\n${mapping || "No reference images; use the written character appearance."}\nIDENTITY RULES:\nDepict the exact same individual across all scenes, not a similar-looking substitute. MASTER FACE images take priority for facial geometry, eye shape and spacing, eyebrows, nose, lips, jawline, apparent age, skin tone and hair. MASTER BODY images take priority for physique and visible proportions. Use both roles together; do not copy one reference's pose, framing, clothes or background unless requested. Keep natural skin texture and distinguishing features, without beautifying, changing ethnicity, reshaping facial features or inventing hidden anatomical details. The character's text must never override identity shown in the references. Change scene, clothing, pose, expression, lighting and framing to satisfy the latest request. If the user explicitly asks for scenery or objects without a person, show only that subject.\nPHOTOGRAPHY:\nDefault to an ordinary realistic smartphone photo, believable anatomy, natural perspective, contact, light and shadows. No artificial glamour, plastic skin, exaggerated bokeh, wide-angle facial distortion, captions, chat bubbles or interface.\n${input.profile ? "PROFILE COMPOSITION: a clean square head-and-shoulders portrait, face clearly visible, eyes naturally open, relaxed neutral expression, simple unobtrusive background. Preserve the same face and physique; do not produce a multi-view modeling sheet or collage." : "Use the requested composition and scene. A selfie means this same person photographing themself. Do not turn body references into a collage or modeling sheet unless specifically requested."}\nCharacter context (personality and scene details only):\n${input.characterPrompt.slice(0,6000)}\nRecent conversation:\n${(input.context || "").slice(-6000)}\nLatest image request:\n${input.request}`;
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(180000)]);
  const generate=async(model:string)=>{
    const options={model,prompt,n:1,size:"1024x1024",quality:"medium",output_format:"jpeg",output_compression:80,
      ...(references.length ? {images:references.map(ref=>({image_url:ref.url}))} : {}),
      ...(references.length && ["gpt-image-1","gpt-image-1.5"].includes(model) ? {input_fidelity:"high"} : {}),
    };
    const response=await fetch(`https://api.openai.com/v1/images/${references.length ? "edits" : "generations"}`,{
      method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(options),signal,
    });
    return {response,result:await response.json()};
  };
  let model=process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  let generated=await generate(model);
  if ([400,404].includes(generated.response.status) && /model/i.test(String(generated.result.error?.code || generated.result.error?.param || "")) && model!=="gpt-image-1.5") {
    model="gpt-image-1.5";generated=await generate(model);
  }
  if (!generated.response.ok) {
    const status=generated.response.status;
    console.warn("CHARACTER_IMAGE_FAILED",status,generated.result.error?.code || "unknown");
    throw new ImageGenerationError(status===429 ? "사진 생성 사용 한도에 도달했어. 잠시 후 다시 요청해 줘." :
      /moderation|safety|content_policy/i.test(String(generated.result.error?.code || "")) ? "이 사진은 생성할 수 없어. 다른 장면으로 요청해 줘." :
      references.length && /image|url/i.test(String(generated.result.error?.param || "")) ? "기준 사진을 읽지 못했어. 설정에서 사진을 다시 올려 줘." :
      status===401 || status===403 ? "사진 생성 API 권한을 확인해야 해." : "사진을 만들지 못했어. 다시 요청해 줘.");
  }
  const encoded=generated.result.data?.[0]?.b64_json;
  if (typeof encoded!=="string") throw new ImageGenerationError("사진을 만들지 못했어. 다시 요청해 줘.");
  const edge=input.profile ? 384 : 1024;
  const bytes=await sharp(Buffer.from(encoded,"base64")).resize(edge,edge,{fit:"inside",withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  const image={dataUrl:`data:image/jpeg;base64,${bytes.toString("base64")}`,mimeType:"image/jpeg" as const};
  if (image.dataUrl.length>(input.profile ? 200000 : 1850000)) throw new ImageGenerationError("사진이 너무 커. 다시 요청해 줘.");
  return {image,model,referenceUsed:references.length>0,referenceCount:references.length,faceCount:input.references.face.length,bodyCount:input.references.body.length};
}

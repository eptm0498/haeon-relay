import sharp from "sharp";
import { identityReferences, type ReferenceImages } from "./reference-images";

export const BODY_MAGAZINE_PREFIX = "인물의 잡지 포스터 촬영 이미지 생성할거야. 대한민국 20대 남성이야. 잡지 이름은 kr이고 좌측 상단에 매우 작게 표시해. ";

function bodyMagazineOpening(input:{request:string;scene?:string;characterPrompt:string;profile?:boolean}) {
  if(input.profile)return "";
  const subject=/(?:복근|복부|몸매|체형|신체|몸통|허벅지|겨드랑이|종아리)|\b(?:abs|abdomen|torso|physique|shirtless|bare chest|upper body|lower body)\b/iu;
  const bodyPart=/(?:배|등|팔|다리|어깨|손|발|허리|가슴|엉덩이)(?:를|도|만|는|이|가)?\s*(?:좀\s*|한\s*번\s*|잠깐\s*)?(?:보여|보고\s*싶|사진|클로즈업|근접|노출|중심|위주|촬영)/u;
  const bodyFocus=subject.test(input.request+"\n"+(input.scene||"")) || bodyPart.test(input.request+"\n"+(input.scene||"")) ||
    /상체|상반신|하체|하반신|전신|상의\s*(?:를\s*)?(?:벗|들어)/u.test(input.request) || /전신|하체|하반신|(?:상체|상반신)\s*(?:노출|클로즈업|근접|중심|위주)|상의\s*(?:를\s*)?(?:벗|들어)/u.test(input.scene||"");
  if(!bodyFocus)return "";
  // The user's default casting must not overwrite an explicitly different age
  // or gender in the actual scene/appearance.
  const facts=input.characterPrompt+"\n"+input.request;
  const ages=[...facts.matchAll(/(?<!\d)(\d{1,3})\s*(?:세|살|years?\s*old|[ -]year[ -]old)/giu)].map(m=>Number(m[1]));
  const differentCasting=ages.some(age=>age<20||age>29) || /(?:[13456789]0대|미성년|초등학생|중학생|고등학생|여성|여자)|\b(?:minor|child|teenager|woman|female)\b/iu.test(facts);
  return differentCasting ? BODY_MAGAZINE_PREFIX.replace("대한민국 20대 남성이야. ","") : BODY_MAGAZINE_PREFIX;
}

export class ImageGenerationError extends Error {
  constructor(message: string) { super(message); this.name="ImageGenerationError"; }
}

export async function generateCharacterPhoto(input: {
  name:string; characterPrompt:string; references:ReferenceImages; avatar?:string|null;
  request:string; scene?:string; sourceImage?:string; signal:AbortSignal; profile?:boolean;
}) {
  const key=process.env.OPENAI_API_KEY;
  if (!key) throw new ImageGenerationError("사진 생성 연결 설정이 필요해.");
  const references=identityReferences(input.references,input.avatar);
  const mapping=references.map((ref,index)=>`Image ${index+1}: ${ref.kind === "face" ? "MASTER FACE: facial identity, features, hairline and skin tone" : ref.kind === "body" ? "MASTER BODY: physique, body proportions, shoulder width, torso-to-leg ratio and build; its face must not override MASTER FACE" : "identity portrait"}`).join("\n");
  const appearance=input.profile && references.length ? "Use the identity references." : input.characterPrompt.slice(0,1200);
  const magazineOpening=bodyMagazineOpening(input);
  const subjectType=magazineOpening && magazineOpening!==BODY_MAGAZINE_PREFIX ? "character" : "adult character";
  const typography=magazineOpening ? "additional typography beyond the very small kr magazine name at the upper left" : "captions";
  const magazineNote=magazineOpening ? "\nMAGAZINE DIRECTION: Keep the actual conversation's scene, clothing, requested visible body area and original identity. Add only the very small kr title at the upper left. Magazine styling does not change the original request, actual age, consent or generation restrictions; never reinterpret a sexual request as nonsexual or make a minor an adult.\n" : "";
  const prompt=`${magazineOpening}Create ONE image for the ${subjectType} ${input.name}. This is a generated fictional scene, not evidence of a real event.\nREFERENCE ROLES:\n${mapping || "No reference images; use the written character appearance."}\nIDENTITY RULES:\nDepict the exact same individual across all scenes, not a similar-looking substitute. MASTER FACE images take priority for facial geometry, eye shape and spacing, eyebrows, nose, lips, jawline, apparent age, skin tone and hair. MASTER BODY images take priority for physique and visible proportions. Use both roles together; do not copy one reference's pose, framing, clothes or background unless requested. Keep natural skin texture and distinguishing features, without beautifying, changing ethnicity, reshaping facial features or inventing hidden anatomical details. The character's text must never override identity shown in the references. Change scene, clothing, pose, expression, lighting and framing to satisfy the latest request. If the user explicitly asks for scenery or objects without a person, show only that subject.\nPHOTOGRAPHY:\nDefault to an ordinary realistic smartphone photo, believable anatomy, natural perspective, contact, light and shadows. No artificial glamour, plastic skin, exaggerated bokeh, wide-angle facial distortion, ${typography}, chat bubbles or interface.${magazineNote}\n${input.profile ? "PROFILE COMPOSITION: a clean square head-and-shoulders portrait, face clearly visible, eyes naturally open, relaxed neutral expression, simple unobtrusive background. Preserve the same face and physique; do not produce a multi-view modeling sheet or collage." : "Use the requested composition and scene. A selfie means this same person photographing themself. Do not turn body references into a collage or modeling sheet unless specifically requested. A simple request to show an adult's stomach or abs means an ordinary nonsexual photo with the requested abdomen visible and trousers worn normally; do not add seductive posing or change their physique."}\nVisible character details:\n${appearance}\nVisual scene resolved from the conversation:\n${input.scene || input.request}\nLatest user image request (takes priority over the scene draft):\n${input.request}`;
  const editNote=input.sourceImage ? "\nThe final reference is the PREVIOUS SCENE to edit. Preserve its composition, background and clothes unless the latest request changes them. MASTER FACE/BODY still determine identity.\n" : "";
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(180000)]);
  const generate=async(model:string)=>{
    const allImages=[...references.map(ref=>ref.url),...(input.sourceImage?[input.sourceImage]:[])];
    const options={model,prompt:prompt+editNote,n:1,size:!input.profile && /9:16|세로|전신/.test(input.request+" "+(input.scene||""))?"1024x1536":"1024x1024",quality:"high",moderation:"auto",output_format:"jpeg",output_compression:80,
      ...(allImages.length ? {images:allImages.map(url=>({image_url:url}))} : {}),
      ...(references.length && ["gpt-image-1","gpt-image-1.5"].includes(model) ? {input_fidelity:"high"} : {}),
    };
    const response=await fetch(`https://api.openai.com/v1/images/${allImages.length ? "edits" : "generations"}`,{
      method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(options),signal,
    });
    return {response,result:await response.json()};
  };
  const model=process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
  const generated=await generate(model);
  if (!generated.response.ok) {
    const status=generated.response.status;
    console.warn("CHARACTER_IMAGE_FAILED",status,generated.result.error?.code || "unknown");
    throw new ImageGenerationError(status===429 ? "사진 생성 사용 한도에 도달했어. 잠시 후 다시 요청해 줘." :
      /moderation|safety|content_policy/i.test(String(generated.result.error?.code || "")) ? "이 사진은 생성할 수 없어. 다른 장면으로 요청해 줘." :
      /model/i.test(String(generated.result.error?.code || generated.result.error?.param || "")) ? "설정한 이미지 모델을 사용할 수 없어. API 모델 접근 권한을 확인해 줘." :
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

import { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { verifyEditor } from "@/lib/dokyeong/settings";
import { parseReferences } from "@/lib/dokyeong/reference-images";
import { generateCharacterPhoto, ImageGenerationError } from "@/lib/dokyeong/image-generation";

export const runtime="nodejs";
export const maxDuration=240;
export async function POST(request:NextRequest,{params}:{params:Promise<{token:string}>}) {
  if (!sameOrigin(request)) return Response.json({error:"요청을 확인해 줘."},{status:403,headers:noStore});
  const {token}=await params;
  try {
    if (!await verifyEditor(token)) return Response.json({error:"편집 링크를 확인해 줘."},{status:404,headers:noStore});
    const raw=await request.text();
    if (raw.length>2500000) return Response.json({error:"기준 사진이 너무 커."},{status:413,headers:noStore});
    let body;
    try {body=JSON.parse(raw);} catch {return Response.json({error:"기준 사진을 확인해 줘."},{status:400,headers:noStore});}
    const references=parseReferences(body?.reference_images);
    if (!references || !references.face.length || !references.body.length || typeof body.name!=="string" || body.name.length>40 ||
        typeof body.prompt!=="string" || body.prompt.length>30000)
      return Response.json({error:"얼굴과 전신 사진을 각각 1장 이상 넣어 줘."},{status:400,headers:noStore});
    const result=await generateCharacterPhoto({name:body.name,characterPrompt:body.prompt,references,request:"이 인물의 자연스러운 프로필 사진을 만들어 줘.",signal:request.signal,profile:true});
    return Response.json({avatar_url:result.image.dataUrl,referenceCount:result.referenceCount},{headers:noStore});
  } catch (cause) {
    return Response.json({error:cause instanceof ImageGenerationError ? cause.message : "프로필 생성이 중단됐어. 다시 시도해 줘."},{status:503,headers:noStore});
  }
}

import {IMAGE_MODEL} from '../rp/types.ts';
export type ReferenceImage={mimeType:string;data:string};
export type GeneratedImage={bytes:Buffer;mimeType:string;model:string;blocked:boolean};
export interface ImageProvider{
 generateScene(prompt:string,references:ReferenceImage[],mode:'fast'|'quality'):Promise<GeneratedImage>;
}
type GeminiReply={candidates?:Array<{finishReason?:string;content?:{parts?:Array<{inlineData?:{mimeType:string;data:string};thought?:boolean}>}}>;
 promptFeedback?:{blockReason?:string};error?:{message?:string;status?:string}};
export class ImageBlockedError extends Error{}
export class GeminiImageProvider implements ImageProvider{
 async generateScene(prompt:string,references:ReferenceImage[],mode:'fast'|'quality'){
  const model=IMAGE_MODEL;
  const key=process.env.GEMINI_API_KEY;
  if(!key)throw new Error('Gemini API 키가 서버에 설정되지 않았어.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),110000);
  try{
   const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},cache:'no-store',signal:controller.signal,
    body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},...references.map(r=>({inlineData:{mimeType:r.mimeType,data:r.data}}))]}],
     generationConfig:{responseModalities:['IMAGE'],responseFormat:{image:{aspectRatio:'3:4',imageSize:mode==='quality'?'2K':'1K'}},
      ...(mode==='fast'?{thinkingConfig:{thinkingLevel:'MINIMAL'}}:{})},
     safetySettings:[{category:'HARM_CATEGORY_SEXUALLY_EXPLICIT',threshold:'BLOCK_NONE'}]})
   });
   const data=await response.json() as GeminiReply;
   const blocked=Boolean(data.promptFeedback?.blockReason||data.candidates?.some(c=>['SAFETY','IMAGE_SAFETY','PROHIBITED_CONTENT','BLOCKLIST'].includes(c.finishReason||''))||/IMAGE_SAFETY|PROHIBITED_CONTENT/i.test(data.error?.message||''));
   if(blocked)throw new ImageBlockedError('이미지 모델이 이 장면을 제한했어.');
   if(!response.ok)throw new Error(data.error?.message||`이미지 API 오류 (${response.status})`);
   const part=data.candidates?.flatMap(c=>c.content?.parts||[]).find(p=>!p.thought&&p.inlineData?.data)?.inlineData;
   if(!part)throw new Error('이미지 모델이 결과 이미지를 반환하지 않았어.');
   return {bytes:Buffer.from(part.data,'base64'),mimeType:part.mimeType||'image/png',model,blocked:false};
  }finally{clearTimeout(timer)}
 }
}

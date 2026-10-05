import {liveConfig} from './config';
export async function geminiJson<T>(prompt:string,schema:object,signal?:AbortSignal,image?:{mimeType:string;data:string}):Promise<T> {
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Gemini not configured');
 const call=async(model:string)=>fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
  method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
  body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},...(image?[{inlineData:image}]:[])]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,maxOutputTokens:6000,temperature:0.6,thinkingConfig:{thinkingLevel:'low'}}}),
  signal:AbortSignal.any([signal||AbortSignal.timeout(55000),AbortSignal.timeout(55000)]),cache:'no-store'
 });
 let response=await call(liveConfig.gemini.responseModel);
 if([403,404].includes(response.status))response=await call(liveConfig.gemini.fallbackModel);
 if(!response.ok)throw new Error(`Gemini JSON ${response.status}`);
 const result=await response.json();const text=(result.candidates?.[0]?.content?.parts||[]).filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||'').join('');
 return JSON.parse(text);
}

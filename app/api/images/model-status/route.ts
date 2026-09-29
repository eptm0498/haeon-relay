import {NextResponse} from 'next/server';
export async function GET(){
 const key=process.env.GEMINI_API_KEY;
 if(!key)return NextResponse.json({error:'Gemini API 키가 서버에 없어.'},{status:503});
 const models=['gemini-3.1-flash-image','gemini-3.1-flash-lite','gemini-3.1-pro-preview'];
 const results=await Promise.all(models.map(async model=>{
  try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`,{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(10000),cache:'no-store'});return {model,available:r.ok,status:r.status}}
  catch{return {model,available:false,status:0}}
 }));
 return NextResponse.json({models:results},{headers:{'Cache-Control':'no-store'}});
}

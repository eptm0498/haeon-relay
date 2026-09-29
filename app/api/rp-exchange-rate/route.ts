import {NextResponse} from 'next/server';

export async function GET(){
 try{
  const response=await fetch('https://api.frankfurter.dev/v2/rate/USD/KRW',{next:{revalidate:3600},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('환율 조회 실패');
  const data=await response.json() as {date?:string;rate?:number};
  if(!Number.isFinite(data.rate)||!data.rate||data.rate<100)throw new Error('환율 응답 오류');
  return NextResponse.json({rate:data.rate,date:data.date},{headers:{'Cache-Control':'public, max-age=3600'}});
 }catch{return NextResponse.json({error:'현재 환율을 불러오지 못했어.'},{status:503})}
}

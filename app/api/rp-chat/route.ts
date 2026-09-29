import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {cost,models} from '@/lib/rp/types';
import {characterFields} from '@/lib/rp/character-fields';
import {formatRoleplay} from '@/lib/rp/format';
export const maxDuration=120;
type GeminiResponse={candidates?:{content?:{parts?:{text?:string;thought?:boolean}[]}}[];usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number;totalTokenCount?:number};error?:{message?:string}};
async function generate(model:string,body:object):Promise<GeminiResponse>{
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('서버에 Gemini API 키가 설정되지 않았어.');
 let last='';for(let attempt=0;attempt<3;attempt++){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),85000);
  try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
   const data=await r.json() as GeminiResponse;
   if(r.ok)return data;
   last=data.error?.message||`Gemini 오류 (${r.status})`;
   if(![429,500,502,503,504].includes(r.status))throw new Error(last);
  }finally{clearTimeout(timeout)}
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,700*(2**attempt)));
 }
 throw new Error(last||'Gemini 요청에 실패했어.');
}
function output(data:GeminiResponse){return (data.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('').trim()}
function usage(data:GeminiResponse,model:string){const input=data.usageMetadata?.promptTokenCount||0;const outputTokens=(data.usageMetadata?.candidatesTokenCount||0)+(data.usageMetadata?.thoughtsTokenCount||0);return {input_tokens:input,output_tokens:outputTokens,thinking_tokens:data.usageMetadata?.thoughtsTokenCount||0,cost_usd:cost(model,input,outputTokens)}}
export async function POST(req:NextRequest){
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return NextResponse.json({error:'로그인이 필요해.'},{status:401});
  const url='https://ckesuyinmcqemgeemzlh.supabase.co',key='sb_publishable_AcLmzX23b71DIBhx-0IRCg_ms7gbAni';
  const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||!user||user.email!=='eptm0498+rp@gmail.com')return NextResponse.json({error:'접근할 수 없는 계정이야.'},{status:403});
  const {sessionId,regenerate}=await req.json() as {sessionId?:string;regenerate?:boolean};
  if(!sessionId||!/^[0-9a-f-]{36}$/i.test(sessionId))return NextResponse.json({error:'잘못된 대화야.'},{status:400});
  const {data:session,error:se}=await db.from('rp_sessions').select('*').eq('id',sessionId).single();if(se||!session)return NextResponse.json({error:'대화를 찾지 못했어.'},{status:404});
  if(!models.includes(session.model))return NextResponse.json({error:'지원하지 않는 모델이야.'},{status:400});
  const [{data:character},{data:persona},{data:memories},{data:rawMessages}]=await Promise.all([
   db.from('rp_characters').select('*').eq('id',session.character_id).single(),
   session.persona_id?db.from('rp_personas').select('*').eq('id',session.persona_id).single():Promise.resolve({data:null}),
   db.from('rp_memories').select('*').eq('session_id',sessionId).order('created_at'),
   db.from('rp_messages').select('*').eq('session_id',sessionId).order('ordinal')]);
  if(!character||!rawMessages?.length)return NextResponse.json({error:'캐릭터나 메시지가 없어.'},{status:400});
  const messages=[...rawMessages];const oldAnswer=regenerate&&messages.at(-1)?.role==='model'?messages.pop():null;
  if(messages.at(-1)?.role!=='user')return NextResponse.json({error:'답변할 사용자 메시지가 없어.'},{status:400});
  let summary=session.summary||'';let lastId=session.last_summarized_message_id as string|null;
  // Roughly 30 exchanges = 60 messages. Older material is compressed once every 12 new messages.
  if(messages.length>66){
   const older=messages.slice(0,-60);const lastIndex=lastId?older.findIndex(m=>m.id===lastId):-1;
   const pending=older.slice(lastIndex+1);
   if(pending.length>=6||!summary){
    const compact=await generate('gemini-2.5-flash',{contents:[{role:'user',parts:[{text:`기존 요약:\n${summary}\n\n새 대화:\n${pending.map(m=>`${m.role==='user'?'사용자':'캐릭터'}: ${m.content}`).join('\n')}\n\nJSON으로만 응답: {"summary":"사건의 인과, 관계 변화, 미해결 약속 등을 1200자 이내로 압축한 한국어 요약","memories":["장기적으로 기억해야 할 새 사실 1", "새 사실 2"]}. 캐릭터 고정 설정은 반복하지 마. 새 기억은 정말 중요한 사실만 최대 3개, 없으면 빈 배열.`}]}],generationConfig:{temperature:0.2,maxOutputTokens:1100,responseMimeType:'application/json'}});
    const compactText=output(compact);if(compactText){let parsed:{summary?:string;memories?:string[]}={};try{parsed=JSON.parse(compactText)}catch{parsed={summary:compactText}};summary=(parsed.summary||compactText).slice(0,2500);lastId=older.at(-1)!.id;
     const su=usage(compact,'gemini-2.5-flash');
     await db.from('rp_usage').insert({session_id:sessionId,character_id:character.id,model:'gemini-2.5-flash',purpose:'summary',...su});
     await db.from('rp_sessions').update({summary,last_summarized_message_id:lastId}).eq('id',sessionId);
     const known=new Set((memories||[]).map(m=>m.content));for(const fact of (parsed.memories||[]).slice(0,3))if(typeof fact==='string'&&fact.length<400&&!known.has(fact)){await db.from('rp_memories').insert({session_id:sessionId,content:fact});known.add(fact);(memories||[]).push({content:fact})}
    }
   }
  }
  const profile=characterFields(character);
  const system=`너는 아래 남성 캐릭터로 역할극을 진행한다. 설정을 대화 길이에 관계없이 우선한다. 세계관과 비밀은 일관되게 유지하되 비밀을 갑자기 드러내지 않는다. 사용자의 행동과 감정을 대신 확정하지 않는다. 설명이나 시스템 메타 발언을 대사에 섞지 않는다. OOC가 명시되면 역할극 밖에서 간결히 답한다.\n\n[캐릭터 고정 설정]\n이름: ${profile.name}\n성별: 남성\n나이: ${profile.age}\n외모: ${profile.appearance}\n정보: ${profile.personality}\n세계관: ${profile.world}\n비밀: ${profile.secrets}\n첫 장면: ${profile.opening}\n\n[사용자 페르소나]\n${persona?`${persona.name}: ${persona.description}`:'지정 없음'}\n\n[현재 세션 요약]\n${summary||'없음'}\n\n[중요 기억]\n${(memories||[]).map(m=>`- ${m.content}`).join('\n')||'없음'}\n\n[출력 형식]\n별표로 둘러싼 *상황 묘사*만 서술이고 별표 없는 문장은 대사다. 사용자 입력도 같은 규칙으로 해석한다. 상황 묘사는 답변 전체에서 최대 한 문장만 쓰고 *문장 양끝에 별표*를 붙인다. 이후는 대사만 쓴다. 대사에는 별표를 붙이지 않는다. 상황 묘사가 필요 없다면 대사만 쓴다. OOC 응답에는 이 형식을 강요하지 않는다.\n\n답변 길이: ${session.length==='short'?'짧게, 대화 중심':session.length==='long'?'대사를 길고 풍부하게':'자연스러운 보통 길이'}. 최근 대화의 언어를 이어가.`;
  const recent=messages.slice(-60).map(m=>({role:m.role==='model'?'model':'user',parts:[{text:m.is_ooc?`[OOC] ${m.content}`:m.content}]}));
  const thinking=session.model.startsWith('gemini-3')?{thinkingLevel:session.thinking==='low'?'LOW':session.thinking==='high'?'HIGH':'MEDIUM'}:{thinkingBudget:session.thinking==='low'?1024:session.thinking==='high'?8192:4096};
  const response=await generate(session.model,{systemInstruction:{parts:[{text:system}]},contents:recent,generationConfig:{temperature:0.9,thinkingConfig:thinking}});
  const raw=output(response);const text=messages.at(-1)?.is_ooc?raw:formatRoleplay(raw);if(!text)throw new Error('모델이 빈 답변을 반환했어. 다시 시도해 줘.');
  const u=usage(response,session.model);
  const {data:message,error:insertError}=await db.from('rp_messages').insert({session_id:sessionId,role:'model',content:text,model:session.model,...u}).select().single();if(insertError)throw insertError;
  if(oldAnswer)await db.from('rp_messages').delete().eq('id',oldAnswer.id);
  await Promise.all([db.from('rp_usage').insert({session_id:sessionId,character_id:character.id,model:session.model,purpose:'reply',...u}),db.from('rp_sessions').update({updated_at:new Date().toISOString()}).eq('id',sessionId)]);
  return NextResponse.json({message,summary});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'응답 생성 중 오류가 났어.'},{status:500})}
}

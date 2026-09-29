import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {GeminiImageProvider,ImageBlockedError} from '@/lib/image-generation/provider';
import {makeSceneSnapshot,parseSnapshot,scenePrompt} from '@/lib/image-generation/scene';
export const maxDuration=180;
const bucket='rp-studio-private';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const running=new Set<string>();
export async function POST(req:NextRequest){
 const started=Date.now();let model='unknown',referenceCount=0,blocked=false,success=false,lock='';
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return NextResponse.json({error:'로그인이 필요해.'},{status:401});
  const db=createClient('https://ckesuyinmcqemgeemzlh.supabase.co','sb_publishable_AcLmzX23b71DIBhx-0IRCg_ms7gbAni',{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||user?.email!=='eptm0498+rp@gmail.com')return NextResponse.json({error:'접근할 수 없는 계정이야.'},{status:403});
  const body=await req.json() as {sessionId?:string;mode?:'fast'|'quality';sourceImageId?:string;revision?:string};
  if(!body.sessionId||!uuid.test(body.sessionId)||body.sourceImageId&&!uuid.test(body.sourceImageId)||body.revision&&body.revision.length>300||!['fast','quality'].includes(body.mode||'fast'))return NextResponse.json({error:'잘못된 요청이야.'},{status:400});
  const mode=body.mode||'fast';model=mode==='quality'?'gemini-3-pro-image':'gemini-3.1-flash-image';lock=`${user.id}:${body.sessionId}`;
  if(running.has(lock))return NextResponse.json({error:'이미지를 생성 중이야.'},{status:409});running.add(lock);
  const {data:session,error:sessionError}=await db.from('rp_sessions').select('*').eq('id',body.sessionId).single();
  if(sessionError||!session)return NextResponse.json({error:'채팅을 찾지 못했어.'},{status:404});
  const [{data:character},{data:persona},{data:memories},{data:references},{data:source}]=await Promise.all([
   db.from('rp_characters').select('*').eq('id',session.character_id).single(),
   session.persona_id?db.from('rp_personas').select('*').eq('id',session.persona_id).single():Promise.resolve({data:null}),
   db.from('rp_memories').select('content').eq('session_id',session.id).limit(20),
   db.from('rp_character_references').select('path').eq('character_id',session.character_id).order('created_at').limit(3),
   body.sourceImageId?db.from('rp_scene_images').select('*').eq('id',body.sourceImageId).eq('session_id',session.id).single():Promise.resolve({data:null})]);
  if(!character||!references?.length)return NextResponse.json({error:'먼저 캐릭터 설정에서 기준 이미지를 등록해 줘.'},{status:400});
  if(body.sourceImageId&&!source)return NextResponse.json({error:'원본 장면을 찾지 못했어.'},{status:404});
  const {data:messages,error:messageError}=await db.from('rp_messages').select('id,ordinal,role,content,is_ooc').eq('session_id',session.id).order('ordinal',{ascending:false}).limit(12);
  if(messageError)throw messageError;
  if(!source&&!messages?.length&&!character.opening)throw new Error('이미지로 만들 대화 장면이 아직 없어.');
  const anchor=source?{id:source.anchor_message_id,ordinal:source.anchor_ordinal}:messages?.[0]?{id:messages[0].id,ordinal:messages[0].ordinal}:{id:null,ordinal:0};
  const snapshot=source?parseSnapshot(JSON.stringify(source.snapshot)):await makeSceneSnapshot({character,persona,summary:session.summary||'',memories:(memories||[]).map(m=>m.content),messages:messages?.length?[...messages].reverse():[{role:'model',content:`${character.scenario}\n${character.opening}`}]});
  const images=await Promise.all(references.map(async r=>{
   const {data,error}=await db.storage.from(bucket).download(r.path);if(error||!data)throw new Error('기준 이미지를 읽지 못했어.');
   if(data.size>3*1024*1024)throw new Error('기준 이미지는 장당 3MB 이하여야 해.');
   return {mimeType:data.type||'image/jpeg',data:Buffer.from(await data.arrayBuffer()).toString('base64')};
  }));referenceCount=images.length;
  const provider=new GeminiImageProvider();let result;
  try{result=await provider.generateScene(scenePrompt(snapshot,character.name,body.revision||''),images,mode)}
  catch(e){if(!(e instanceof ImageBlockedError))throw e;blocked=true;result=await provider.generateScene(scenePrompt(snapshot,character.name,body.revision||'',true),images,mode)}
  const id=crypto.randomUUID(),ext=result.mimeType==='image/jpeg'?'jpg':result.mimeType==='image/webp'?'webp':'png',path=`${user.id}/scenes/${id}.${ext}`;
  const {error:uploadError}=await db.storage.from(bucket).upload(path,result.bytes,{contentType:result.mimeType,upsert:false});if(uploadError)throw uploadError;
  const {data:image,error:insertError}=await db.from('rp_scene_images').insert({id,session_id:session.id,character_id:character.id,anchor_message_id:anchor.id,anchor_ordinal:anchor.ordinal||0,path,snapshot,model,softened:blocked}).select().single();
  if(insertError){await db.storage.from(bucket).remove([path]);throw insertError}
  await db.from('rp_usage').insert({session_id:session.id,character_id:character.id,model,purpose:'image',cost_usd:(mode==='quality'?0.134:0.067)+referenceCount*(mode==='quality'?0.0011:0.001)});
  const {data:signed,error:signError}=await db.storage.from(bucket).createSignedUrl(path,3600);if(signError)throw signError;
  success=true;return NextResponse.json({image:{...image,url:signed.signedUrl},softened:blocked});
 }catch(e){if(e instanceof ImageBlockedError)blocked=true;return NextResponse.json({error:e instanceof ImageBlockedError?'이미지 모델이 이 장면을 제한했어.':e instanceof Error?e.message:'이미지 생성에 실패했어.'},{status:e instanceof ImageBlockedError?422:500})}
 finally{if(lock)running.delete(lock);console.info('rp_scene_image',{model,duration_ms:Date.now()-started,success,safety_block:blocked,reference_count:referenceCount})}
}

'use client';
import {useCallback,useEffect,useState} from 'react';
import Image from 'next/image';
import {db} from '@/lib/rp/db';
import type {SceneImage} from '@/lib/rp/types';
import './viewer.css';

export default function SceneViewer(){
 const [sessionId,setSessionId]=useState(''),[mode,setMode]=useState<'fast'|'quality'>('fast'),[image,setImage]=useState<SceneImage|null>(null),[busy,setBusy]=useState(false),[note,setNote]=useState('이미지를 기다리는 중…'),[revision,setRevision]=useState(''),[editing,setEditing]=useState(false);
 const load=useCallback(async(id:string)=>{
  const {data,error}=await db.from('rp_scene_images').select('*').eq('session_id',id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error){setNote('이미지를 불러오지 못했어.');return}
  if(!data)return;
  const {data:url,error:linkError}=await db.storage.from('rp-studio-private').createSignedUrl(data.path,3600);
  if(linkError){setNote('이미지 접근 권한을 확인해 줘.');return}
  setImage({...data,url:url.signedUrl});setNote('');setBusy(false);
 },[]);
 useEffect(()=>{
  const id=new URLSearchParams(location.search).get('session')||'';
  if(!/^[0-9a-f-]{36}$/i.test(id)){setNote('대화를 찾지 못했어.');return}
  setSessionId(id);setMode(new URLSearchParams(location.search).get('mode')==='quality'?'quality':'fast');load(id);
  const channel=new BroadcastChannel('rp-scene-'+id);
  channel.onmessage=event=>{if(event.data?.type==='loading'){setBusy(true);setNote('현재 장면을 생성하는 중…')}else if(event.data?.type==='ready'){load(id)}else if(event.data?.type==='error'){setBusy(false);setNote(event.data.message||'이미지 생성에 실패했어.')}};
  const timer=setInterval(()=>load(id),60000);
  return()=>{channel.close();clearInterval(timer)};
 },[load]);
 async function generate(extra=''){
  if(!sessionId||busy)return;
  setBusy(true);setNote('현재 장면을 생성하는 중…');
  try{
   const {data:{session}}=await db.auth.getSession();
   const response=await fetch('/api/images/generate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token||''}`},body:JSON.stringify({sessionId,mode,sourceImageId:image?.id,revision:extra})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'이미지를 생성하지 못했어.');
   setImage(result.image);setNote(result.softened?'이미지 모델 제한으로 장면을 일부 완화했어.':'');setEditing(false);setRevision('');
  }catch(e){setNote(e instanceof Error?e.message:'이미지를 생성하지 못했어.')}finally{setBusy(false)}
 }
 async function save(){if(!image)return;const {data,error}=await db.storage.from('rp-studio-private').download(image.path);if(error||!data){setNote('이미지를 저장하지 못했어.');return}const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=`rp-scene-${image.id}.${data.type==='image/jpeg'?'jpg':'png'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
 return <main className="rp-image-viewer" lang="ko" translate="no">
  {image?.url&&<Image unoptimized fill sizes="100vw" className="viewer-photo" src={image.url} alt="현재 대화 장면"/>}
  {(busy||note||!image)&&<div className="viewer-status">{busy&&<span className="viewer-spinner"/>}{note||'이미지를 기다리는 중…'}</div>}
  {image&&<div className="viewer-actions"><button disabled={busy} onClick={()=>generate()}>다시 생성</button><button disabled={busy} onClick={()=>setEditing(v=>!v)}>장면 수정</button><button onClick={save}>저장</button></div>}
  {editing&&<form className="viewer-revision" onSubmit={e=>{e.preventDefault();if(revision.trim())generate(revision.trim())}}><input autoFocus placeholder="조명, 구도, 자세 등을 짧게 입력" value={revision} onChange={e=>setRevision(e.target.value)} maxLength={300}/><button disabled={busy||!revision.trim()}>적용</button></form>}
 </main>;
}

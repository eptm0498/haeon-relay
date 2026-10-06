"use client";
import {useEffect,useRef,useState} from 'react';
import styles from './live.module.css';
type Job={id:string;status:string;attempts:number;error:string;created_at:string;updated_at:string};
const dismissedKey=(id:string)=>'live-dismissed-image-errors:'+id;
function dismissed(id:string):string[]{try{const value=JSON.parse(localStorage.getItem(dismissedKey(id))||'[]');return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}}
function visible(jobs:Job[],characterId:string,lastUserAt:number){const hidden=new Set(dismissed(characterId));return jobs.filter(j=>j.status!=='failed'||!hidden.has(j.id)&&lastUserAt<=Date.parse(j.created_at));}
export function useImageJobs(characterId:string,enabled:boolean,onChange:()=>void,lastUserAt=0){
 const [snapshot,setSnapshot]=useState<{characterId:string;jobs:Job[]}>({characterId:'',jobs:[]}),[error,setError]=useState('');const refresh=useRef(onChange);refresh.current=onChange;
 const jobs=snapshot.characterId===characterId?visible(snapshot.jobs,characterId,lastUserAt):[];
 useEffect(()=>{
  if(!enabled||!characterId)return;let alive=true;let running=false;let prior='';
  const poll=async()=>{if(running||document.hidden)return;running=true;try{const r=await fetch('/api/dokyeong/images?characterId='+characterId,{cache:'no-store'});if(!r.ok)return;const next:Job[]=await r.json();const key=JSON.stringify(next);if(alive&&prior!==key){prior=key;setSnapshot({characterId,jobs:next});refresh.current();}}catch{}finally{running=false;}};
  void poll();const timer=setInterval(()=>void poll(),3000);window.addEventListener('focus',poll);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',poll);};
 },[characterId,enabled]);
 function dismiss(id:string){try{localStorage.setItem(dismissedKey(characterId),JSON.stringify([...new Set([...dismissed(characterId),id])].slice(-100)));}catch{}setSnapshot(current=>({...current,jobs:current.jobs.filter(j=>j.id!==id)}));setError('');}
 async function retry(id:string){setError('');try{const r=await fetch('/api/dokyeong/images',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry',id})});const result=await r.json();if(!r.ok)throw Error(result.error);setSnapshot(current=>({...current,jobs:current.jobs.map(j=>j.id===id?{...j,status:'queued'}:j)}));}catch(e){setError((e as Error).message);}}
 return {jobs,error,retry,dismiss};
}
export function ImageJobTray({state}:{state:ReturnType<typeof useImageJobs>}){
 return <>{state.jobs.filter(j=>j.status!=='complete').map(j=><div key={j.id} className={styles.jobCard} role="status">{j.status==='failed'?<><span>{j.error||'사진 생성이 중단됐어.'}</span>{j.attempts<3&&<button onClick={()=>void state.retry(j.id)}>같은 사진 다시 시도</button>}<button onClick={()=>state.dismiss(j.id)} aria-label="사진 생성 실패 안내 닫기">닫기</button></>:<span>사진을 만들고 있어… 앱을 닫아도 이어서 진행해.</span>}</div>)}{state.error&&<p role="alert">{state.error}</p>}</>;
}

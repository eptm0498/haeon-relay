"use client";
import {useEffect,useRef,useState} from 'react';
import styles from './live.module.css';
type Job={id:string;status:string;attempts:number;error:string};
export function useImageJobs(characterId:string,enabled:boolean,onChange:()=>void){
 const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState('');const refresh=useRef(onChange);refresh.current=onChange;
 useEffect(()=>{
  if(!enabled||!characterId)return;let alive=true;let running=false;let prior='';
  const poll=async()=>{if(running||document.hidden)return;running=true;try{const r=await fetch('/api/dokyeong/images?characterId='+characterId,{cache:'no-store'});if(!r.ok)return;const next:Job[]=await r.json();const key=JSON.stringify(next);if(alive&&prior!==key){prior=key;setJobs(next);refresh.current();}}catch{}finally{running=false;}};
  void poll();const timer=setInterval(()=>void poll(),3000);window.addEventListener('focus',poll);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',poll);};
 },[characterId,enabled]);
 async function retry(id:string){setError('');try{const r=await fetch('/api/dokyeong/images',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry',id})});const result=await r.json();if(!r.ok)throw Error(result.error);setJobs(items=>items.map(j=>j.id===id?{...j,status:'queued'}:j));}catch(e){setError((e as Error).message);}}
 return {jobs,error,retry};
}
export function ImageJobTray({state}:{state:ReturnType<typeof useImageJobs>}){
 return <>{state.jobs.filter(j=>j.status!=='complete').map(j=><div key={j.id} className={styles.jobCard} role="status">{j.status==='failed'?<><span>{j.error||'사진 생성이 중단됐어.'}</span>{j.attempts<3&&<button onClick={()=>void state.retry(j.id)}>같은 사진 다시 시도</button>}</>:<span>사진을 만들고 있어… 앱을 닫아도 이어서 진행해.</span>}</div>)}{state.error&&<p role="alert">{state.error}</p>}</>;
}

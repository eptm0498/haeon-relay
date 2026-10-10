"use client";
import {useState} from 'react';
import {validMessageSessionSettings,type MessageSession} from '@/lib/dokyeong/message-session';
import styles from './live.module.css';
export function MessageSessionSettings({name,session,onStart,onStop}:{name:string;session?:MessageSession|null;onStart:(minutes:number,count:number)=>Promise<void>;onStop:()=>Promise<void>}) {
 const [minutes,setMinutes]=useState(String(session?.minutes||30));
 const [count,setCount]=useState(String(session?.total||30));
 const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const active=session?.status==='active';
 const status=session?({active:'진행 중',completed:'완료',stopped:'중단됨',expired:'시간 종료'}[session.status]):'';
 return <div className={styles.tools}><details>
  <summary>연속 선톡{active&&` · ${session.sent}/${session.total}개`}</summary>
  <form className={styles.toolFields} onSubmit={async event=>{
   event.preventDefault();setError('');
   if(!validMessageSessionSettings(Number(minutes),Number(count))){setError('1~180분, 1~120개로 설정해 줘. 분당 최대 2개까지 가능해.');return;}
   setSaving(true);try{await onStart(Number(minutes),Number(count));}finally{setSaving(false);}
  }}>
   <p>{name}에게 답하지 않아도 짧은 한 문장씩 와. 답하면 그 내용을 이어서 반영해.</p>
   <div className={styles.sessionInputs}>
    <label>시간 (분)<input type="number" min={1} max={180} step={1} required value={active?session.minutes:minutes} disabled={active||saving} onChange={e=>setMinutes(e.target.value)}/></label>
    <label>메시지 (개)<input type="number" min={1} max={120} step={1} required value={active?session.total:count} disabled={active||saving} onChange={e=>setCount(e.target.value)}/></label>
   </div>
   <p>설정한 시간 안에서 간격을 랜덤하게 나눠 보내. 일반 답장은 개수에 포함되지 않아. 일반 선톡이 꺼져 있어도 이 예약은 따로 진행돼.</p>
   {session&&<p role="status">{status} · {session.sent}/{session.total}개{active&&` · ${new Date(session.endsAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit'})} 종료`}</p>}
   {active?<button type="button" disabled={saving} onClick={async()=>{setSaving(true);try{await onStop();}finally{setSaving(false);}}}>{saving?'저장 중…':'연속 선톡 중단'}</button>:<button type="submit" disabled={saving}>{saving?'시작 중…':`${name} 연속 선톡 시작`}</button>}
   {error&&<p role="alert">{error}</p>}
  </form>
 </details></div>;
}

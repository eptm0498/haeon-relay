"use client";
import {useEffect,useState} from 'react';
import type {Message} from './useSharedHistory';
import styles from './live.module.css';
type Preferences={quiet_start:number;quiet_end:number;daily_cap:number;interval_hours:number;image_daily_limit:number;character_daily_cap:number;image_used_today?:number;routine:string;situation:string;version:number};
type Memory={epoch:string;summary:string;covered_count:number;message_count:number};
type Archive={messages:Message[];before:number|null;epoch:string};
export async function dataCall<T>(action:string,characterId?:string,data?:object):Promise<T>{
 const response=await fetch('/api/dokyeong/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,characterId,data})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'다시 시도해 줘.');return result;
}
export default function LiveTools({characterId,name,onOlder,onReset,onTestNotification}:{characterId:string;name:string;onOlder:(messages:Message[])=>void;onReset:(keep:boolean)=>void;onTestNotification:()=>Promise<void>}){
 const [preferences,setPreferences]=useState<Preferences|null>(null),[memory,setMemory]=useState<Memory|null>(null),[summary,setSummary]=useState('');
 const [query,setQuery]=useState(''),[date,setDate]=useState(''),[results,setResults]=useState<Message[]|null>(null),[before,setBefore]=useState<number|undefined>();
 const [feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false),[keep,setKeep]=useState(true);
 useEffect(()=>{
  let alive=true;setBefore(undefined);setResults(null);setFeedback('');
  Promise.all([dataCall<Preferences>('settings'),dataCall<Memory>('memory',characterId)]).then(([p,m])=>{if(alive){setPreferences(p);setMemory(m);setSummary(m.summary||'');setBefore(m.message_count>100?m.message_count-99:1);}}).catch(e=>{if(alive)setFeedback(e.message);});return()=>{alive=false;};
 },[characterId]);
 async function work(fn:()=>Promise<void>){setBusy(true);setFeedback('');try{await fn();}catch(e){setFeedback((e as Error).message);}finally{setBusy(false);}}
 async function older(){const page=await dataCall<Archive>('archive',characterId,{before});onOlder(page.messages);setBefore(page.before||1);setFeedback(page.messages.length?'이전 대화를 불러왔어.':'더 오래된 기록이 없어.');}
 async function search(){const page=await dataCall<Archive>('search',characterId,{query,date});setResults(page.messages.filter(m=>!date||new Date(m.ts||0).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})===date));}
 async function download(){
  const all:Message[]=[];let cursor:number|undefined;let epoch='';
  for(let i=0;i<1000;i++){const page=await dataCall<Archive>('export',characterId,{before:cursor});if(epoch&&epoch!==page.epoch)throw Error('대화가 바뀌었어. 다시 내려받아 줘.');epoch=page.epoch;all.unshift(...page.messages);if(page.messages.length<100||!page.before||page.before===cursor)break;cursor=page.before;}
  const text=all.map(m=>`[${new Date(m.ts||0).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}] ${m.role==='user'?'나':name}: ${m.image?'[사진] ':''}${m.content}`).join('\n\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`LIVE-${name}-${new Date().toISOString().slice(0,10)}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setFeedback('대화 TXT 파일을 내려받았어. 사진은 표시만 포함돼.');
 }
 return <div className={styles.tools}>
  <details><summary>선톡 시간·상황·사진 한도</summary>{preferences&&<div className={styles.toolFields}>
   <p>모든 캐릭터에 적용돼. 방해 금지 시작과 끝을 같게 하면 시간 제한을 꺼.</p>
   <label>방해 금지 시작<select value={preferences.quiet_start} onChange={e=>setPreferences({...preferences,quiet_start:Number(e.target.value)})}>{Array.from({length:24},(_,i)=><option key={i} value={i}>{i}시</option>)}</select></label>
   <label>방해 금지 끝<select value={preferences.quiet_end} onChange={e=>setPreferences({...preferences,quiet_end:Number(e.target.value)})}>{Array.from({length:24},(_,i)=><option key={i} value={i}>{i}시</option>)}</select></label>
   <label>선톡 하루 총 한도<input type="number" min={1} max={20} value={preferences.daily_cap} onChange={e=>setPreferences({...preferences,daily_cap:Number(e.target.value)})}/></label>
   <label>캐릭터별 최소 간격(시간)<input type="number" min={1} max={24} value={preferences.interval_hours} onChange={e=>setPreferences({...preferences,interval_hours:Number(e.target.value)})}/></label>
   <label>캐릭터별 하루 선톡 한도<input type="number" min={1} max={10} value={preferences.character_daily_cap||2} onChange={e=>setPreferences({...preferences,character_daily_cap:Number(e.target.value)})}/></label>
   <p>오늘 사진 요청 {preferences.image_used_today||0}개 / {preferences.image_daily_limit}개</p>
   <label>사진 하루 생성 한도<input type="number" min={1} max={100} value={preferences.image_daily_limit} onChange={e=>setPreferences({...preferences,image_daily_limit:Number(e.target.value)})}/></label>
   <label>생활·근무 일정<textarea aria-label="생활·근무 일정" maxLength={2000} value={preferences.routine} onChange={e=>setPreferences({...preferences,routine:e.target.value})}/></label>
   <label>현재 상황<textarea aria-label="현재 상황" maxLength={1000} placeholder="예: 오늘은 쉬는 날. 지금은 게임 중." value={preferences.situation} onChange={e=>setPreferences({...preferences,situation:e.target.value})}/></label>
   <button disabled={busy} onClick={()=>void work(async()=>{await dataCall('settings_save',undefined,preferences);setPreferences(await dataCall<Preferences>('settings'));setFeedback('시간과 상황을 저장했어.');})}>선톡·사진 설정 저장</button>
  </div>}</details>
  <details><summary>{name}의 기억 확인·수정</summary><div className={styles.toolFields}>
   <p>100개 메시지마다 누적 요약해. 현재 {memory?.message_count||0}개 중 {memory?.covered_count||0}개 반영. 수정한 기억은 이후 요약의 기준으로 사용돼.</p>
   <label>기억<textarea aria-label="기억" rows={8} maxLength={12000} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="아직 요약된 기억이 없어. 기억할 내용을 직접 적을 수도 있어."/></label>
   <button disabled={busy||!memory} onClick={()=>void work(async()=>{await dataCall('memory_save',characterId,{epoch:memory?.epoch,summary});const fresh=await dataCall<Memory>('memory',characterId);setMemory(fresh);setFeedback('기억을 저장했어.');})}>기억 저장</button>
   <button disabled={busy||!memory} onClick={()=>void work(async()=>{await dataCall('memory_save',characterId,{epoch:memory?.epoch,summary:''});setSummary('');setMemory(await dataCall<Memory>('memory',characterId));setFeedback('요약 기억을 지웠어. 대화 기록은 유지돼.');})}>요약 기억 지우기</button>
  </div></details>
  <details><summary>대화 검색·이전 기록·백업</summary><div className={styles.toolFields}>
   <label>검색어<input value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} placeholder="약속, 카페, 이름…"/></label>
   <label>날짜(선택)<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <button disabled={busy} onClick={()=>void work(search)}>대화 검색</button>
   {results&&<div className={styles.searchResults}>{results.length?results.map(m=><button key={m.id} onClick={()=>{onOlder([m]);setTimeout(()=>document.getElementById('message-'+m.id)?.scrollIntoView({block:'center'}),150);}}><small>{new Date(m.ts||0).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {m.role==='user'?'나':name}</small>{m.content||'[사진]'}</button>):<p>검색 결과가 없어.</p>}</div>}
   <button disabled={busy||before===1} onClick={()=>void work(older)}>이전 대화 100개 더 보기</button>
   <button disabled={busy} onClick={()=>void work(download)}>전체 대화 TXT 내려받기</button>
  </div></details>
  <details><summary>아이폰 알림 설정 방법</summary><div className={styles.toolFields}>
   <ol><li>Safari에서 LIVE를 열고 공유 → 홈 화면에 추가.</li><li>홈 화면의 LIVE 아이콘으로 앱을 열어.</li><li>위의 ‘앱을 닫아도 선톡 알림 받기’를 누르고 허용.</li><li>아이폰 설정 → 알림 → LIVE에서 잠금 화면·알림 센터·배너·사운드·배지를 켜.</li><li>아래 테스트 알림을 누르고 앱을 홈 화면으로 내려서 도착하는지 확인해.</li></ol>
   <p>알림이 안 오면 집중 모드와 알림 요약, 네트워크 연결을 확인해. 선톡은 5분마다 상황을 판단하므로 정각에 꼭 오는 방식은 아니야.</p>
   <button disabled={busy} onClick={()=>void work(async()=>{await onTestNotification();setFeedback('테스트 알림을 전송했어. 앱을 내려서 확인해 줘.');})}>테스트 알림 보내기</button>
  </div></details>
  <label className={styles.keepMemory}><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/>새 대화에서도 요약 기억 유지</label>
  <button disabled={busy} onClick={()=>onReset(keep)}>이 캐릭터와 새 대화</button>
  {feedback&&<p role="status">{feedback}</p>}
 </div>;
}

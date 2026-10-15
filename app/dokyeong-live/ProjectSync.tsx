"use client";
import {useEffect,useRef,useState} from 'react';
import type {Message} from './useSharedHistory';
import styles from './project-sync.module.css';
type SourceStatus={projectUrl:string;sourceUrl:string;sourceTitle:string;version:number;updatedAt:string;checkedAt:string;messageCount:number;partial:boolean};
type Capture={sourceUrl:string;messages:{id:string;role:'user'|'assistant';content:string}[];partial?:boolean};
const channel='jiwoo-project-bridge-v1';
function bridge<T>(action:string,sourceUrl?:string):Promise<T>{
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const timeout=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(Error(action==='ping'?'연결 프로그램을 설치한 PC 크롬에서 자동 업데이트할 수 있어.':'가져오기 시간이 초과됐어. ChatGPT 탭의 로그인과 로딩 상태를 확인해 줘.'));},action==='ping'?1200:155000);
    function receive(event:MessageEvent){
      if(event.source!==window||event.origin!==location.origin||event.data?.channel!==channel||event.data.direction!=='response'||event.data.id!==id)return;
      window.clearTimeout(timeout);window.removeEventListener('message',receive);
      if(event.data.error)reject(Error(event.data.error));else resolve(event.data as T);
    }
    window.addEventListener('message',receive);window.postMessage({channel,direction:'request',id,action,sourceUrl},location.origin);
  });
}
async function sourceStatus(id:string):Promise<SourceStatus>{
  const response=await fetch('/api/dokyeong/project-context?characterId='+id,{cache:'no-store'});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
async function parseImport(text:string):Promise<Capture['messages']>{
  try{const value=JSON.parse(text);if(Array.isArray(value))return value; if(Array.isArray(value.messages))return value.messages;}catch{}
  const sections=[...text.matchAll(/(?:^|\n)(내가 한 말|나|사용자|도혁|ChatGPT 답변|ChatGPT|지우|한지우)\s*[:：]\s*([\s\S]*?)(?=\n(?:내가 한 말|나|사용자|도혁|ChatGPT 답변|ChatGPT|지우|한지우)\s*[:：]|$)/g)];
  if(!sections.length)throw Error('JSON 또는 “내가 한 말: / ChatGPT 답변:”으로 구분된 대화 텍스트를 넣어 줘.');
  return Promise.all(sections.map(async(m,index)=>{
    const role=/^(내가 한 말|나|사용자|도혁)$/.test(m[1])?'user' as const:'assistant' as const;
    const content=m[2].trim();const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(role+':'+content));
    const hash=Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
    return {id:`manual:${index}:${hash.slice(0,32)}`,role,content};
  }));
}
export default function ProjectSync({characterId,messages,disabled}:{characterId:string;messages:Message[];disabled:boolean}){
  const [source,setSource]=useState<SourceStatus|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[feedback,setFeedback]=useState(''),[text,setText]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    const refresh=()=>{if(document.hidden)return;void sourceStatus(characterId).then(s=>{if(mounted.current)setSource(s);}).catch(e=>{if(mounted.current)setFeedback(e.message);});};
    refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    void bridge<{ready:boolean}>('ping').then(s=>{if(mounted.current)setReady(s.ready);}).catch(()=>{});
    return()=>{mounted.current=false;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[characterId]);
  async function save(capture:Capture,current:SourceStatus){
    const response=await fetch('/api/dokyeong/project-context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId,version:current.version,...capture}),signal:AbortSignal.timeout(120000)});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    if(mounted.current){setSource(result);setFeedback(result.partial?'최근 기록을 반영했어. ChatGPT의 이전 기록은 끝까지 확인하지 못했어.':`업데이트했어. 원본 대화 ${result.messageCount}개를 이어받았어.`);}
  }
  async function update(){
    setBusy(true);setFeedback('');
    try{
      await bridge('ping');setReady(true);
      const current=await sourceStatus(characterId);
      setFeedback('ChatGPT에서 원본 대화를 불러오는 중이야. 새 탭을 닫지 말아 줘.');
      const capture=await bridge<Capture>('capture',current.sourceUrl);
      setFeedback('관계와 사건을 정리해서 반영하고 있어.');await save(capture,current);
    }catch(cause){setFeedback((cause as Error).message);setExpanded(true);}finally{if(mounted.current)setBusy(false);}
  }
  async function manual(){setBusy(true);setFeedback('');try{const current=await sourceStatus(characterId);await save({sourceUrl:current.sourceUrl,messages:await parseImport(text),partial:true},current);setText('');}catch(cause){setFeedback((cause as Error).message);}finally{if(mounted.current)setBusy(false);}}
  async function handoff(){
    try{await navigator.clipboard.writeText('한지우 프로젝트의 기존 사건과 관계를 유지해. 이후 캐릭터 라이브에서 나눈 대화 기록이야. 이 내용을 이어받고 소설 문체를 쓸지는 현재 프로젝트 지침을 따라 줘. 이미 끝난 대화에 다시 답하거나 처음 만남으로 되돌리지 마. 다음에 내가 보내는 말에 이어서 반응해.\n\n'+messages.slice(-40).map(m=>`${m.role==='user'?'도혁':'지우'}: ${m.image?'[사진] ':''}${m.content}`).join('\n\n'));setFeedback('앱 대화를 복사했어. 원본 ChatGPT 대화에 붙여 넣으면 돼.');}catch{setFeedback('복사 권한을 확인해 줘. 앱 대화 내려받기도 사용할 수 있어.');}
  }
  return <section className={styles.panel} aria-label="한지우 프로젝트 연결">
    <div className={styles.row}><button type="button" onClick={()=>void update()} disabled={busy||disabled||!source} title={disabled?'통화를 종료한 뒤 업데이트해 줘.':undefined}>{busy?'업데이트 중…':'대화내용 업데이트'}</button><button type="button" className={styles.detail} onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>프로젝트 연결</button></div>
    <p className={styles.status} role="status">{feedback|| (source?`한지우 · ${source.sourceTitle} · ${source.messageCount}개 · ${source.partial?'최근 기록만 확인':'전체 기록 확인'} · ${new Date(source.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`:'프로젝트 연결을 불러오는 중…')}</p>
    {expanded&&<div className={styles.details}>
      <p>ChatGPT → 지우 업데이트야. 기존 앱 대화는 유지돼. PC에서 반영하면 아이폰에서도 같은 맥락으로 이어져.</p>
      <p>{ready?'크롬 연결 프로그램이 연결됐어.':'자동 가져오기는 PC 크롬에서 연결 프로그램을 한 번 설치해야 해. 아이폰에서는 아래 수동 가져오기를 쓸 수 있어.'}</p>
      <a href="/jiwoo-project-bridge.zip" download>크롬 연결 프로그램 ZIP 받기</a>
      <ol><li>ZIP 압축을 풀어 줘.</li><li>크롬 주소창에 <code>chrome://extensions</code>를 입력하고 개발자 모드를 켜.</li><li>‘압축해제된 확장 프로그램을 로드합니다’에서 manifest.json이 있는 폴더를 선택해.</li><li>같은 크롬에서 ChatGPT 로그인 후 이 앱을 새로고침해.</li></ol>
      {source&&<a href={source.sourceUrl} target="_blank" rel="noreferrer">ChatGPT 원본 대화 열기</a>}
      <button type="button" onClick={()=>void handoff()} disabled={!messages.length}>ChatGPT로 이어가기 복사</button>
      <details><summary>대화 직접 가져오기</summary><label htmlFor="jiwoo-import">대화 JSON 또는 화자가 구분된 대화 텍스트</label><textarea id="jiwoo-import" rows={5} maxLength={800000} value={text} onChange={e=>setText(e.target.value)} placeholder={'내가 한 말:\n오늘 어땠어?\nChatGPT 답변:\n괜찮았어 ㅋㅋ'}/><input aria-label="대화 파일 선택" type="file" accept=".json,.txt,text/plain,application/json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2400000){setFeedback('2.4MB 이하 대화 파일을 선택해 줘.');return;}setText(await f.text());}}/><button type="button" onClick={()=>void manual()} disabled={busy||disabled||!text.trim()}>지우 기억에 반영</button></details>
    </div>}
  </section>;
}

"use client";
import {useEffect,useRef,useState} from 'react';
import type {Message} from './useSharedHistory';
import styles from './project-sync.module.css';
import {projectBridge as bridge,PROJECT_BRIDGE_RELEASE,type BridgeConnection} from '@/lib/dokyeong/project-bridge';
type SourceItem={id:string;title:string;url:string;order:number;messageCount:number;partial:boolean;updatedAt:string|null;checkedAt:string|null};
type SourceStatus={projectUrl:string;sourceUrl:string;sourceTitle:string;version:number;updatedAt:string;checkedAt:string;messageCount:number;partial:boolean;sources:SourceItem[]};
type Capture={sourceUrl:string;messages:{id:string;role:'user'|'assistant';content:string}[];partial?:boolean};
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
  const [connectionInfo,setConnectionInfo]=useState('연결 확인 중…');
  const [source,setSource]=useState<SourceStatus|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[feedback,setFeedback]=useState(''),[text,setText]=useState(''),[manualSource,setManualSource]=useState('');
  const mounted=useRef(true),epoch=useRef(0);
  useEffect(()=>{
    mounted.current=true;const generation=++epoch.current;
    setSource(null);setFeedback('');setManualSource('');setBusy(false);setText('');
    const refresh=()=>{if(document.hidden)return;void sourceStatus(characterId).then(s=>{if(mounted.current&&epoch.current===generation)setSource(s);}).catch(e=>{if(mounted.current&&epoch.current===generation)setFeedback(e.message);});};
    refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    void bridge<BridgeConnection>('ping').then(s=>{if(mounted.current&&epoch.current===generation){setReady(s.ready&&s.captureProtocol===2);setConnectionInfo(s.captureProtocol===2?`실행 프로그램 연결됨 · ${s.version}`:`구버전 감지 · ${s.version||'1.0.x'} · ${PROJECT_BRIDGE_RELEASE}으로 교체해 줘.`);}}).catch(e=>{if(mounted.current&&epoch.current===generation){setReady(false);setConnectionInfo(e.message);}});
    return()=>{mounted.current=false;epoch.current=generation+1;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[characterId]);
  async function save(capture:Capture,current:SourceStatus,sourceId:string){
    const response=await fetch('/api/dokyeong/project-context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId,version:current.version,...capture,sourceId}),signal:AbortSignal.timeout(300000)});
    const result=await response.json();if(!response.ok)throw Error(result.error);return result as SourceStatus;
  }
  async function update(only?:string){
    const generation=epoch.current,active=()=>mounted.current&&epoch.current===generation;
    setBusy(true);setExpanded(true);setFeedback('');
    try{
      const connection=await bridge<BridgeConnection>('ping');
      if(!connection.ready||connection.captureProtocol!==2)throw Error(`감지된 연결 프로그램은 ${connection.version||'구버전'}이야. 아래 ZIP의 ${PROJECT_BRIDGE_RELEASE}으로 교체한 뒤 이 앱 탭을 다시 열어 줘.`);
      if(!active())return;setReady(true);setConnectionInfo(`실행 프로그램 연결됨 · ${connection.version}`);
      const current=await sourceStatus(characterId),targets=current.sources.filter(s=>!only||s.id===only),done:string[]=[],failed:string[]=[];
      for(let i=0;i<targets.length;i++){
        if(!active())return;
        const target=targets[i];
        setFeedback(`${target.title} 원본을 읽는 중… (${i+1}/${targets.length}) 새 탭을 닫지 말아 줘.`);
        try{
          const before=await sourceStatus(characterId);
          const capture=await bridge<Capture>('capture',target.url);
          if(!active())return;setFeedback(`${target.title}의 관계와 사건을 정리하는 중…`);
          const next=await save(capture,before,target.id);
          if(!active())return;setSource(next);done.push(target.title);
        }catch(cause){failed.push(`${target.title}: ${(cause as Error).message}`);}
      }
      if(active())setFeedback([done.length?`${done.join(' · ')} 확인 완료.`:'',failed.length?`실패한 방은 기존 기억을 유지했어. ${failed.join(' / ')}`:'',done.length?'방별 상태를 아래에서 확인해 줘.':''].filter(Boolean).join(' '));
    }catch(cause){if(active()){setFeedback((cause as Error).message);setExpanded(true);}}finally{if(active())setBusy(false);}
  }
  async function manual(){
    const generation=epoch.current;setBusy(true);setFeedback('');
    try{
      const current=await sourceStatus(characterId),target=current.sources.find(s=>s.id===(manualSource||current.sources.at(-1)?.id));
      if(!target)throw Error('가져올 채팅방을 선택해 줘.');
      const next=await save({sourceUrl:target.url,messages:await parseImport(text),partial:true},current,target.id);
      if(mounted.current&&epoch.current===generation){setSource(next);setText('');setFeedback(`${target.title}에 반영했어. 다른 채팅방과 기존 앱 대화는 유지돼.`);}
    }catch(cause){if(mounted.current&&epoch.current===generation)setFeedback((cause as Error).message);}finally{if(mounted.current&&epoch.current===generation)setBusy(false);}
  }
  async function handoff(){
    try{await navigator.clipboard.writeText('한지우 프로젝트의 기존 사건과 관계를 유지해. 이후 캐릭터 라이브에서 나눈 대화 기록이야. 이 내용을 이어받고 소설 문체를 쓸지는 현재 프로젝트 지침을 따라 줘. 이미 끝난 대화에 다시 답하거나 처음 만남으로 되돌리지 마. 다음에 내가 보내는 말에 이어서 반응해.\n\n'+messages.slice(-40).map(m=>`${m.role==='user'?'도혁':'지우'}: ${m.image?'[사진] ':''}${m.content}`).join('\n\n'));setFeedback('앱 대화를 복사했어. 프로젝트의 최신 ChatGPT 대화에 붙여 넣으면 돼.');}catch{setFeedback('복사 권한을 확인해 줘. 앱 대화 내려받기도 사용할 수 있어.');}
  }
  return <section className={styles.panel} aria-label="한지우 프로젝트 연결">
    <div className={styles.row}><button type="button" onClick={()=>void update()} disabled={busy||disabled||!source} title={disabled?'통화를 종료한 뒤 업데이트해 줘.':undefined}>{busy?'업데이트 중…':'대화내용 업데이트'}</button><button type="button" className={styles.detail} onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>프로젝트 연결</button></div>
    <p className={styles.status} role="status">{feedback||(source?`한지우 · ${source.sources.map(s=>s.title).join(' → ')} · 총 ${source.messageCount}개 · ${source.partial?'일부 기록 포함':'전체 기록 확인'}`:'프로젝트 연결을 불러오는 중…')}</p>
    {expanded&&<div className={styles.details}>
      <p>버튼 한 번으로 연결된 채팅방을 순서대로 확인해. 뒤의 채팅방이 최신이고, 오래된 방을 다시 읽어도 최신 상황을 과거로 되돌리지 않아. 기존 앱 대화는 유지돼.</p>
      <p>지정된 한지우 프로젝트 대화만 가져와. ChatGPT의 내부 메모리·개인 프로필·다른 프로젝트를 읽거나 원본에 글을 쓰지 않아. PC에서 반영하면 아이폰에서도 이어져.</p>
      <div className={styles.sources}>{source?.sources.map(s=><div key={s.id} className={styles.source}><a href={s.url} target="_blank" rel="noreferrer">{s.title} 원본 열기</a><span>{s.messageCount}개 · {!s.updatedAt?'아직 안 가져옴':s.partial?'최근 기록만 확인':'전체 기록 확인'}{s.checkedAt?` · 확인 ${new Date(s.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`:''}</span><button type="button" onClick={()=>void update(s.id)} disabled={busy||disabled}>이 방 업데이트</button></div>)}</div>
      <p role="status">{connectionInfo}</p><p>{ready?'연결 확인을 통과했어. 대화내용 업데이트를 누르면 돼.':`PC 크롬 연결 프로그램 ${PROJECT_BRIDGE_RELEASE}이 필요해. 새 ZIP을 설치 폴더에 풀고 확장 프로그램을 새로고침한 뒤 이 앱 탭을 다시 열어 줘. 아이폰은 아래 수동 가져오기를 쓸 수 있어.`}</p>
      <a href={`/jiwoo-project-bridge.zip?v=${PROJECT_BRIDGE_RELEASE}`} download={`jiwoo-project-bridge-${PROJECT_BRIDGE_RELEASE}.zip`}>크롬 연결 프로그램 ZIP 받기 · {PROJECT_BRIDGE_RELEASE}</a>
      <ol><li>ZIP 압축을 풀어 줘.</li><li>크롬 주소창에 <code>chrome://extensions</code>를 입력하고 개발자 모드를 켜.</li><li>‘압축해제된 확장 프로그램을 로드합니다’에서 manifest.json이 있는 폴더를 선택해. 이미 설치했다면 그 폴더의 파일을 교체하고 확장 프로그램의 새로고침 버튼을 눌러.</li><li>같은 크롬에서 ChatGPT 로그인 후 이 앱을 새로고침해.</li></ol>
      <button type="button" onClick={()=>void handoff()} disabled={!messages.length}>ChatGPT로 이어가기 복사</button>
      <details><summary>대화 직접 가져오기</summary><label htmlFor="jiwoo-source">가져올 채팅방</label><select id="jiwoo-source" value={manualSource||source?.sources.at(-1)?.id||''} onChange={e=>setManualSource(e.target.value)} disabled={busy}>{source?.sources.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select><label htmlFor="jiwoo-import">대화 JSON 또는 화자가 구분된 대화 텍스트</label><textarea id="jiwoo-import" rows={5} maxLength={800000} value={text} onChange={e=>setText(e.target.value)} placeholder={'내가 한 말:\n오늘 어땠어?\nChatGPT 답변:\n괜찮았어 ㅋㅋ'}/><input aria-label="대화 파일 선택" type="file" accept=".json,.txt,text/plain,application/json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2400000){setFeedback('2.4MB 이하 대화 파일을 선택해 줘.');return;}setText(await f.text());}}/><button type="button" onClick={()=>void manual()} disabled={busy||disabled||!text.trim()}>선택한 방의 기억에 반영</button></details>
    </div>}
  </section>;
}

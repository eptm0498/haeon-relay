"use client";

import { useState } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import type { EditorStory, StorySource } from "@/lib/dokyeong/story-settings";
import styles from "./editor.module.css";

const fields=[
  ["instructions","성격·관계·세계관","지우가 누구인지, 도혁과 어떤 관계인지 적어 줘."],
  ["current_state","현재 상황과 가장 최근 기억","과거 기록과 다를 때 이 내용이 우선 적용돼."],
  ["style_guide","말투와 대화 리듬","기존 대화방에서 느꼈던 어감과 반응 방식을 조정해."],
  ["intimacy_prompt","성적인 상황의 대사·반응 (직접 입력)","직접 작성하는 전용 칸이야. 비워 두면 이 항목의 추가 지침을 넣지 않아. 입력한 내용은 채팅과 음성에 공통으로 적용돼."],
  ["chat_prompt","채팅 표현","채팅에서 쓰는 어미·줄바꿈·반응 표현을 정해."],
  ["voice_prompt","음성 표현","음성에서 발음할 입말과 채팅 표현의 변환 방식을 정해."],
] as const;

export default function StoryEditor({value,onChange,api,characterId,disabled}:{value:EditorStory;onChange:(value:EditorStory)=>void;api:string;characterId:string;disabled:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [source,setSource]=useState<StorySource|null>(null);
  const [sourceBusy,setSourceBusy]=useState(false);
  const [sourceError,setSourceError]=useState("");
  const filtered=value.memory_excerpts.map((item,index)=>({item,index})).filter(({item})=>!search||item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())||item.sourceId.includes(search));
  const pages=Math.max(1,Math.ceil(filtered.length/20));
  const currentPage=Math.min(page,pages-1);
  async function loadSource(offset=0) {
    setSourceBusy(true);setSourceError("");
    try {
      const response=await fetch(`${api}/story?characterId=${characterId}&offset=${offset}`,{cache:"no-store"});
      const result=await response.json();
      if (!response.ok) throw Error(result.error||"원문을 불러오지 못했어.");
      setSource(result);
    } catch(cause){setSourceError(cause instanceof Error?cause.message:"원문을 불러오지 못했어.");}
    finally{setSourceBusy(false);}
  }
  return <section className={styles.storyEditor} aria-label="전체 기억과 말투">
    <div className={styles.storyHeading}>
      <div><BookOpen size={23}/><h2>전체 기억과 말투</h2></div>
      <button type="button" className={styles.modeButton} onClick={()=>setExpanded(!expanded)}>{expanded?"항목 접기":"모두 펼치기"}</button>
    </div>
    <p className={styles.storyHelp}>실제 대화에서 참고하는 설정 전체야. 내용을 고친 뒤 <strong>변경사항 저장</strong>을 누르면 다음 대화부터 적용돼. 원래 ChatGPT 대화방에는 영향을 주지 않아.</p>
    <div className={styles.storyMeta}>{value.source_title} · 원문 {value.message_count.toLocaleString()}개 메시지 · 사건 {value.chapters.length}개 · 대사 {value.examples.length}개 · 발췌 {value.memory_excerpts.length}개</div>
    <fieldset disabled={disabled} className={styles.storyFields}>
      {fields.map(([key,label,help])=><details key={key} open={expanded||key==="instructions"||key==="intimacy_prompt"} className={styles.storySection}>
        <summary>{label}<span>{value[key].length.toLocaleString()}자</span></summary>
        <div className={styles.storyBody}><p>{help}</p><label className={styles.srOnly} htmlFor={`story-${key}`}>{label}</label><textarea id={`story-${key}`} className={`${styles.textarea} ${styles.storyText}`} value={value[key]} maxLength={60000} spellCheck={false} onChange={e=>onChange({...value,[key]:e.target.value})}/></div>
      </details>)}
      <details open={expanded} className={styles.storySection}>
        <summary>사건별 기억 전체<span>{value.chapters.length}개</span></summary>
        <div className={styles.storyBody}>
          <p>각 사건을 펼치면 기억 전문을 볼 수 있어. 검색어는 관련 기억을 고를 때 사용돼.</p>
          {value.chapters.map((chapter,index)=><details key={chapter.id} open={expanded} className={styles.storyItem}>
            <summary>{index+1}. {chapter.title||"새 사건"}<span>{chapter.facts.length.toLocaleString()}자</span></summary>
            <div className={styles.storyBody}>
              <label htmlFor={`chapter-title-${index}`}>사건 제목</label><input id={`chapter-title-${index}`} value={chapter.title} maxLength={200} onChange={e=>onChange({...value,chapters:value.chapters.map((c,i)=>i===index?{...c,title:e.target.value}:c)})}/>
              <label htmlFor={`chapter-facts-${index}`}>기억 내용 전체</label><textarea id={`chapter-facts-${index}`} className={`${styles.textarea} ${styles.storyText}`} value={chapter.facts} maxLength={20000} onChange={e=>onChange({...value,chapters:value.chapters.map((c,i)=>i===index?{...c,facts:e.target.value}:c)})}/>
              <label htmlFor={`chapter-terms-${index}`}>검색어 (쉼표로 구분)</label><input id={`chapter-terms-${index}`} value={chapter.terms.join(", ")} onChange={e=>onChange({...value,chapters:value.chapters.map((c,i)=>i===index?{...c,terms:e.target.value.split(",").map(t=>t.trim())}:c)})}/>
              <button type="button" className={styles.removeButton} onClick={()=>onChange({...value,chapters:value.chapters.filter((_,i)=>i!==index)})}><Trash2 size={13}/> 이 사건 삭제</button>
            </div>
          </details>)}
          <button type="button" className={styles.modeButton} onClick={()=>onChange({...value,chapters:[...value.chapters,{id:crypto.randomUUID(),title:"새 사건",facts:"",terms:[],sourceIds:[]}]})}><Plus size={13}/> 사건 추가</button>
        </div>
      </details>
      <details open={expanded} className={styles.storySection}>
        <summary>기존 대화의 실제 대사와 음성 표현<span>{value.examples.length}개</span></summary>
        <div className={styles.storyBody}>
          <p>어감의 기준이 되는 지우의 대사야. 채팅용과 음성용을 각각 고칠 수 있어.</p>
          {value.examples.map((example,index)=><details key={index} open={expanded} className={styles.storyItem}>
            <summary>{index+1}. {example.cue||"새 대사"}</summary>
            <div className={styles.storyBody}>{(["cue","reply","spoken"] as const).map(key=><div key={key}><label htmlFor={`example-${key}-${index}`}>{key==="cue"?"상황 / 검색 주제":key==="reply"?"채팅 대사":"음성 대사"}</label><textarea id={`example-${key}-${index}`} className={`${styles.textarea} ${styles.storyShort}`} value={example[key]} maxLength={key==="cue"?2000:10000} onChange={e=>onChange({...value,examples:value.examples.map((x,i)=>i===index?{...x,[key]:e.target.value}:x)})}/></div>)}
              <button type="button" className={styles.removeButton} onClick={()=>onChange({...value,examples:value.examples.filter((_,i)=>i!==index)})}><Trash2 size={13}/> 이 대사 삭제</button>
            </div>
          </details>)}
          <button type="button" className={styles.modeButton} onClick={()=>onChange({...value,examples:[...value.examples,{cue:"새 대사",reply:"",spoken:"",sourceId:""}]})}><Plus size={13}/> 대사 추가</button>
        </div>
      </details>
      <details open={expanded} className={styles.storySection}>
        <summary>대화에서 검색하는 원문 발췌 전체<span>{value.memory_excerpts.length}개</span></summary>
        <div className={styles.storyBody}>
          <p>최근 주제와 관련된 부분을 찾아 기억 자료로 사용해. 위에서 사실을 수정했다면 관련 발췌도 검색해 함께 고칠 수 있어.</p>
          <label htmlFor="excerpt-search">발췌 내용 검색</label><input id="excerpt-search" value={search} placeholder="찾고 싶은 사건이나 표현" onChange={e=>{setSearch(e.target.value);setPage(0);}}/>
          <div className={styles.storyPaging}><span>{filtered.length.toLocaleString()}개 · {currentPage+1} / {pages}페이지</span><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>이전</button><button type="button" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>다음</button></div>
          {filtered.slice(currentPage*20,(currentPage+1)*20).map(({item,index})=><details key={index} open={expanded} className={styles.storyItem}>
            <summary>발췌 {index+1}<span>{item.text.length.toLocaleString()}자</span></summary>
            <div className={styles.storyBody}><label htmlFor={`excerpt-${index}`}>발췌 내용 전체</label><textarea id={`excerpt-${index}`} className={`${styles.textarea} ${styles.storyText}`} value={item.text} maxLength={15000} onChange={e=>onChange({...value,memory_excerpts:value.memory_excerpts.map((x,i)=>i===index?{...x,text:e.target.value}:x)})}/><button type="button" className={styles.removeButton} onClick={()=>onChange({...value,memory_excerpts:value.memory_excerpts.filter((_,i)=>i!==index)})}><Trash2 size={13}/> 이 발췌 삭제</button></div>
          </details>)}
          {!filtered.length&&<p>일치하는 발췌가 없어.</p>}
          <button type="button" className={styles.modeButton} onClick={()=>{onChange({...value,memory_excerpts:[...value.memory_excerpts,{seq:Math.max(0,...value.memory_excerpts.map(e=>e.seq))+1,sourceId:"직접 추가",text:search}]});setPage(Math.floor(filtered.length/20));}}><Plus size={13}/> 기억 발췌 추가</button>
        </div>
      </details>
    </fieldset>
    <details className={styles.storySection}>
      <summary>처음 가져온 프로젝트 지침·대화 원문 확인<span>보관 기록</span></summary>
      <div className={styles.storyBody}>
        <p>가져온 원문은 비교용으로 보관해. 실제 대화에 쓰는 내용은 위의 설정·기억·발췌에서 수정하면 돼.</p>
        {!source&&<button type="button" disabled={sourceBusy} className={styles.modeButton} onClick={()=>void loadSource()}>{sourceBusy?"원문 불러오는 중…":"원문 보기"}</button>}
        {source&&<>
          <details><summary>당시 프로젝트 지침 전문</summary><pre className={styles.sourceText}>{source.instructions}</pre></details>
          <div className={styles.storyPaging}><span>{source.total?source.offset+1:0}–{Math.min(source.offset+source.messages.length,source.total)} / {source.total}개 메시지</span><button type="button" disabled={sourceBusy||source.offset===0} onClick={()=>void loadSource(Math.max(0,source.offset-20))}>이전</button><button type="button" disabled={sourceBusy||source.offset+20>=source.total} onClick={()=>void loadSource(source.offset+20)}>다음</button></div>
          <form onSubmit={e=>{e.preventDefault();const n=Number(new FormData(e.currentTarget).get("page"));if(Number.isInteger(n)&&n>=1&&n<=Math.ceil(source.total/20))void loadSource((n-1)*20);}}><label htmlFor="source-page">원문 페이지 이동 (1–{Math.max(1,Math.ceil(source.total/20))})</label><input id="source-page" name="page" type="number" min={1} max={Math.max(1,Math.ceil(source.total/20))} defaultValue={Math.floor(source.offset/20)+1} key={source.offset} disabled={sourceBusy} required/><button type="submit" className={styles.modeButton} disabled={sourceBusy}>페이지 이동</button></form>
          {source.messages.map((message,index)=><details key={message.id} className={styles.storyItem}><summary>{source.offset+index+1}. {message.role==="assistant"?"지우 / 원래 답변":"도혁 / 사용자"}</summary><pre className={styles.sourceText}>{message.content}</pre></details>)}
        </>}
        {sourceError&&<p role="alert">{sourceError}</p>}
      </div>
    </details>
  </section>;
}

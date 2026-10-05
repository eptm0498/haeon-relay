"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleAlert, FileText, Link2, MessageCircle, Plus, RotateCcw, Save, Sparkles, Trash2, Volume2 } from "lucide-react";
import SampleManager from "./SampleManager";
import ProfilePhoto from "./ProfilePhoto";
import ReferenceModel from "./ReferenceModel";
import { emptyReferences, type ReferenceImages } from "@/lib/dokyeong/reference-images";
import styles from "./editor.module.css";

type Section = { id: string; title: string; body: string };
type Draft = { intro: string; sections: Section[] };
type Character = {
  id?: string;
  name: string;
  prompt: string;
  voice_id: string;
  voice_name: string;
  avatar_url: string | null;
  reference_images?: ReferenceImages;
  is_default: boolean;
  sort_order: number;
  version: number | null;
  updated_at?: string | null;
};
type Voice = {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  preview_url: string | null;
  labels: Record<string,string>;
  is_owner?: boolean;
};

const blankPrompt = (name: string) => `너는 이 앱 안에서 ${name || "새 캐릭터"}라는 한 사람으로 사용자와 자연스럽게 음성 대화를 한다.
설정에 적힌 성격과 관계를 유지하되 매번 같은 반응을 반복하지 않고 실제 사람처럼 기분, 의견, 취향과 대화 리듬을 가진다.

[기본 성격과 관계]
사용자와의 관계, 성격, 가치관, 좋아하는 것과 싫어하는 것, 중요한 배경을 구체적으로 적는다.

[호칭과 말투]
사용자를 어떻게 부르는지, 평소 말투와 애교·장난·진지한 순간의 말투가 어떻게 달라지는지 적는다.

[애정과 장난]
친밀함, 장난, 놀림, 칭찬, 갈등 상황에서 어떤 식으로 반응하는지 적는다.

[대화 리듬]
짧은 맞장구와 긴 이야기를 상황에 따라 섞고, 사용자가 더 말해 달라고 하면 충분히 이어서 말한다.

[피해야 할 것]
상담사처럼 매번 감정을 정리하거나 질문으로 끝내지 않는다. 설정에 없는 현실 정보나 경험을 사실처럼 만들어내지 않는다.`;

function parsePrompt(prompt: string): Draft {
  const headings = [...prompt.matchAll(/^\[([^\]\n]+)\][ \t]*\n/gm)];
  return {
    intro: prompt.slice(0, headings[0]?.index ?? prompt.length).trim(),
    sections: headings.map((match, index) => ({
      id: String(index),
      title: match[1],
      body: prompt.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? prompt.length).trim(),
    })),
  };
}
function composePrompt(draft: Draft) {
  return [draft.intro.trim(), ...draft.sections.map((section) => `[${section.title.trim()}]\n${section.body.trim()}`)]
    .filter(Boolean).join("\n\n");
}

export default function CharacterEditor({ token }: { token: string }) {
  const api = `/api/dokyeong/character/${token}`;
  const [characters, setCharacters] = useState<Character[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [working, setWorking] = useState<Character | null>(null);
  const [baseline, setBaseline] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [active, setActive] = useState("intro");
  const [tab, setTab] = useState<"profile"|"samples">("profile");
  const [loading, setLoading] = useState(true);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const composed = useMemo(() => draft ? composePrompt(draft) : "", [draft]);
  const currentPrompt = rawMode ? raw : composed;
  const serialized = working ? JSON.stringify({
    name: working.name, prompt: currentPrompt, voice_id: working.voice_id, voice_name: working.voice_name,
    avatar_url: working.avatar_url || "", reference_images:working.reference_images || emptyReferences(), is_default: working.is_default, sort_order: working.sort_order,
  }) : "";
  const dirty = !!working && serialized !== baseline;

  const applyCharacter = useCallback((character: Character) => {
    setWorking({...character});
    setDraft(parsePrompt(character.prompt));
    setRaw(character.prompt);
    setRawMode(false);
    setActive("intro");
    setTab("profile");
    setBaseline(JSON.stringify({
      name: character.name, prompt: character.prompt, voice_id: character.voice_id, voice_name: character.voice_name,
      avatar_url: character.avatar_url || "", reference_images:character.reference_images || emptyReferences(), is_default: character.is_default, sort_order: character.sort_order,
    }));
    setNotice(""); setError("");
  }, []);

  const fetchReferences = useCallback(async (character:Character):Promise<Character> => {
    if (!character.id || character.reference_images) return character;
    const response=await fetch(`${api}/characters?referencesFor=${character.id}`,{cache:"no-store"});
    const result=await response.json();
    if (!response.ok)throw new Error(result.error || "기준 사진을 불러오지 못했어.");
    return {...character,reference_images:result};
  },[api]);

  const loadCharacters = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${api}/characters?listOnly=1`, { cache:"no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "캐릭터를 불러오지 못했어.");
      const keep = data.find((item: Character) => item.is_default) || data[0];
      if (keep) {
        const ready=await fetchReferences(keep);
        setCharacters(data.map((item:Character)=>item.id===ready.id?ready:item));
        applyCharacter(ready);
      } else setCharacters(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "캐릭터를 불러오지 못했어."); }
    finally { setLoading(false); }
  }, [api, applyCharacter, fetchReferences]);

  const loadVoices = useCallback(async () => {
    setVoiceLoading(true);
    try {
      const response = await fetch(`${api}/voices`, { cache:"no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ElevenLabs 목소리를 불러오지 못했어.");
      setVoices((data.voices || []).sort((a: Voice,b: Voice) => {
        const ak = a.category === "cloned" ? 0 : a.labels?.language === "ko" ? 1 : 2;
        const bk = b.category === "cloned" ? 0 : b.labels?.language === "ko" ? 1 : 2;
        return ak-bk || a.name.localeCompare(b.name,"ko");
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ElevenLabs 목소리를 불러오지 못했어.");
    } finally { setVoiceLoading(false); }
  }, [api]);

  useEffect(() => { void loadCharacters(); void loadVoices(); }, [loadCharacters, loadVoices]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function chooseCharacter(character: Character) {
    if (saving || loading) return;
    if (dirty && !window.confirm("저장하지 않은 변경사항을 버리고 다른 캐릭터로 이동할까?")) return;
    setLoading(true);setError("");
    try {
      const ready=await fetchReferences(character);
      setCharacters(previous=>previous.map(item=>item.id===ready.id?ready:item));
      applyCharacter(ready);
    } catch(cause){setError(cause instanceof Error?cause.message:"기준 사진을 불러오지 못했어.");}
    finally{setLoading(false);}
  }

  function newCharacter() {
    if (dirty && !window.confirm("저장하지 않은 변경사항을 버리고 새 캐릭터를 만들까?")) return;
    const firstVoice = voices.find(v => v.category === "cloned") || voices[0];
    const character: Character = {
      name:"새 캐릭터", prompt:blankPrompt("새 캐릭터"),
      voice_id:firstVoice?.voice_id || "", voice_name:firstVoice?.name || "",
      avatar_url:null, is_default:false, sort_order:characters.length, version:null,
    };
    setWorking(character); setDraft(parsePrompt(character.prompt)); setRaw(character.prompt);
    setRawMode(false); setActive("intro"); setTab("profile");
    setBaseline("__NEW__"); setNotice(""); setError("");
  }

  function setPromptDraft(next: Draft) { setDraft(next); setNotice(""); }
  function selectSection(id: string) { if (rawMode) setDraft(parsePrompt(raw)); setActive(id); setRawMode(false); }
  function toggleMode() { if (rawMode) { setDraft(parsePrompt(raw)); setActive("intro"); } else setRaw(composed); setRawMode(!rawMode); }

  async function save() {
    if (!working || saving || imageBusy) return;
    if (!working.name.trim() || currentPrompt.length < 100 || currentPrompt.length > 30000 || !working.voice_id) {
      setError("이름, 캐릭터 설정, ElevenLabs 목소리를 확인해 줘."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const selectedVoice = voices.find(v => v.voice_id === working.voice_id);
      const payload = {...working, prompt:currentPrompt, voice_name:selectedVoice?.name || working.voice_name || ""};
      const response = await fetch(`${api}/characters`, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "저장하지 못했어.");
      setNotice("저장했어. 라이브의 다음 대화부터 이 설정과 목소리를 사용해.");
      await loadCharacters();
      const refreshed = {...data, prompt:currentPrompt};
      applyCharacter(refreshed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했어."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!working?.id || !window.confirm(`${working.name} 캐릭터를 삭제할까? 대화 샘플도 같이 삭제돼.`)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`${api}/characters?id=${working.id}`, {method:"DELETE"});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "삭제하지 못했어.");
      setWorking(null); setBaseline(""); await loadCharacters();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했어."); }
    finally { setSaving(false); }
  }

  const selected = draft?.sections.find(section => section.id === active);
  const voice = voices.find(v => v.voice_id === working?.voice_id);

  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <div className={styles.brand}><span className={styles.mark}>C.</span><span>CHARACTER<span className={styles.brandLight}>LIVE</span><small>MULTI CHARACTER STUDIO</small></span></div>
      <div className={styles.topActions}>
        <a className={styles.liveLink} href="/dokyeong-live" target="_blank" rel="noreferrer">라이브 열기 <ChevronRight size={16}/></a>
        <button className={styles.saveTop} disabled={!dirty || saving || imageBusy} onClick={() => void save()}><Save size={17}/>{saving ? "저장 중…" : "변경사항 저장"}</button>
      </div>
    </header>

    <main className={styles.main}>
      <aside className={styles.sidebar}>
        <div className={styles.sideHeading}>캐릭터 <span>{characters.length}명</span></div>
        <nav className={styles.nav} aria-label="캐릭터 선택">
          {characters.map(character => <button key={character.id} className={`${styles.navItem} ${working?.id===character.id ? styles.navActive : ""}`} onClick={() => chooseCharacter(character)}>
            <span className={styles.navDot}/><span className={styles.navLabel}>{character.name}{character.is_default ? " · 기본" : ""}</span>
          </button>)}
        </nav>
        <button className={styles.addButton} onClick={newCharacter}><Plus size={17}/> 캐릭터 추가</button>
        <div className={styles.sideBottom}><span className={styles.statusDot}/> 각 캐릭터 설정과 목소리를 따로 저장<br/><span className={styles.date}>도경의 기존 설정과 샘플은 그대로 이전했어.</span></div>
      </aside>

      <section className={styles.content}>
        <div className={styles.eyebrow}>CHARACTER LIVE <ChevronRight size={13}/> STUDIO</div>
        <div className={styles.titleRow}><div><h1>{working?.name || "캐릭터 설정실"}<span className={styles.titleStar}>✳</span></h1><p>성격, 대화 샘플, 프로필과 ElevenLabs 목소리를 캐릭터마다 따로 관리해.</p></div><div className={styles.badge}>● LIVE SETTINGS</div></div>

        {loading ? <div className={styles.centerState}>캐릭터를 불러오는 중…</div> : !working ? <div className={styles.centerState}><CircleAlert size={26}/>캐릭터가 없어.</div> : <>
          <div className={styles.mobileNav}>
            <label htmlFor="mobile-character">편집할 캐릭터</label>
            <select id="mobile-character" value={working.id || "new"} disabled={saving || imageBusy} onChange={e=>{
              if(e.target.value==="new")newCharacter();
              else {const character=characters.find(c=>c.id===e.target.value);if(character)chooseCharacter(character);}
            }}>
              {characters.map(character=><option key={character.id} value={character.id}>{character.name}</option>)}
              <option value="new">새 캐릭터 추가</option>
            </select>
          </div>
          <div className={styles.tabs} role="tablist">
            <button role="tab" aria-selected={tab==="profile"} className={tab==="profile"?styles.tabActive:""} onClick={()=>setTab("profile")}><Sparkles size={16}/> 캐릭터 설정</button>
            <button role="tab" aria-selected={tab==="samples"} className={tab==="samples"?styles.tabActive:""} onClick={()=>setTab("samples")} disabled={!working.id}><MessageCircle size={16}/> 대화 샘플</button>
          </div>

          {tab==="samples" && working.id ? <SampleManager token={token} characterId={working.id} characterName={working.name}/> : <>
            <div className={styles.editorCard}>
              <div className={styles.cardHeader}><div className={styles.cardIcon}><Volume2 size={23}/></div><div className={styles.cardTitles}><span className={styles.overline}>IDENTITY / VOICE</span><h2>이름과 목소리</h2><p>ElevenLabs에 만들어 둔 목소리 중 이 캐릭터가 사용할 목소리를 지정해.</p></div></div>
              <div className={styles.fieldArea}>
                <div className={styles.nameField}><label htmlFor="character-name">캐릭터 이름</label><input id="character-name" value={working.name} maxLength={40} onChange={e=>setWorking({...working,name:e.target.value})}/></div>
                <label htmlFor="voice-select">ElevenLabs 목소리</label>
                <select id="voice-select" value={working.voice_id} onChange={e=>{
                  const picked=voices.find(v=>v.voice_id===e.target.value);
                  setWorking({...working,voice_id:e.target.value,voice_name:picked?.name||""});
                }} style={{width:"100%",background:"#101115",border:"1px solid #3b3d44",borderRadius:9,color:"#f1f1f1",padding:"12px 13px"}}>
                  {!working.voice_id && <option value="">목소리 선택</option>}
                  {working.voice_id && !voices.some(v=>v.voice_id===working.voice_id) && <option value={working.voice_id}>{working.voice_name || working.voice_id} · 현재 설정</option>}
                  {voices.map(v=><option key={v.voice_id} value={v.voice_id}>{v.name} · {v.category || "voice"}{v.labels?.language ? ` · ${v.labels.language}` : ""}</option>)}
                </select>
                <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
                  <span style={{fontSize:11,color:"#8d9098"}}>{voiceLoading ? "목소리 목록 확인 중…" : `사용 가능한 목소리 ${voices.length}개`}</span>
                  <button type="button" className={styles.modeButton} onClick={()=>void loadVoices()} disabled={voiceLoading}>{voiceLoading?"불러오는 중…":"목록 새로고침"}</button>
                </div>
                {!voiceLoading && voices.length > 0 && <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:8,maxHeight:220,overflowY:"auto",marginTop:10,paddingRight:3}}>
                  {voices.map(v=>{
                    const picked=working.voice_id===v.voice_id;
                    return <button key={v.voice_id} type="button" aria-pressed={picked} onClick={()=>setWorking({...working,voice_id:v.voice_id,voice_name:v.name})}
                      style={{textAlign:"left",border:picked?"1px solid #d9ff67":"1px solid #34363d",background:picked?"#252d1e":"#1b1c21",color:picked?"#eaffaa":"#d7d8dc",borderRadius:9,padding:"10px 11px",minHeight:54}}>
                      <span style={{display:"block",fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.name}</span>
                      <span style={{display:"block",fontSize:9.5,color:picked?"#b8ce74":"#777a82",marginTop:5}}>{v.category || "voice"}{v.labels?.language ? ` · ${v.labels.language}` : ""}</span>
                    </button>;
                  })}
                </div>}
                {voice?.preview_url && <audio controls preload="none" src={voice.preview_url} style={{height:36,maxWidth:"100%",marginTop:12}}/>}
                <ReferenceModel key={`references-${working.id || "new"}`} name={working.name} prompt={currentPrompt} api={api} value={working.reference_images || emptyReferences()} disabled={saving}
                  onBusyChange={setImageBusy}
                  onChange={reference_images=>{setWorking(previous=>previous?{...previous,reference_images}:previous);setNotice("");}}
                  onProfile={avatar_url=>{setWorking(previous=>previous?{...previous,avatar_url}:previous);setNotice("프로필을 만들었어. 저장하면 기준 사진과 함께 적용돼.");}}/>
                <ProfilePhoto key={`profile-${working.id || "new"}`} name={working.name} value={working.avatar_url} disabled={saving || imageBusy}
                  onChange={avatar_url => { setWorking(previous => previous ? {...previous, avatar_url} : previous); setNotice(""); }}/>
                <label style={{display:"flex",gap:8,alignItems:"center",marginTop:14}}><input type="checkbox" checked={working.is_default} onChange={e=>setWorking({...working,is_default:e.target.checked})}/> 앱을 열었을 때 기본 캐릭터로 사용</label>
              </div>
            </div>

            <div className={styles.mobileNav}><label htmlFor="section-select">편집할 항목</label><select id="section-select" value={active} onChange={e=>selectSection(e.target.value)}><option value="intro">기본 설정</option>{draft?.sections.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
            <div className={styles.editorCard}>
              <div className={styles.cardHeader}><div className={styles.cardIcon}>{rawMode?<FileText size={23}/>:<Sparkles size={23}/>}</div><div className={styles.cardTitles}><span className={styles.overline}>CHARACTER PROFILE</span><h2>{rawMode?"전체 원문 편집":active==="intro"?"기본 설정":selected?.title}</h2><p>말투, 관계, 성격과 반응 방식을 이 캐릭터만의 설정으로 작성해.</p></div><button className={styles.modeButton} onClick={toggleMode}>{rawMode?"항목별 편집":"전체 원문"}</button></div>
              <div className={styles.fieldArea}>
                {rawMode ? <><label htmlFor="raw-prompt">전체 지침</label><textarea id="raw-prompt" className={`${styles.textarea} ${styles.rawArea}`} value={raw} onChange={e=>{setRaw(e.target.value);setNotice("");}} spellCheck={false}/></>
                : active==="intro" && draft ? <><label htmlFor="intro">기본 역할과 관계</label><textarea id="intro" className={styles.textarea} value={draft.intro} onChange={e=>setPromptDraft({...draft,intro:e.target.value})} spellCheck={false}/></>
                : selected && draft ? <><label htmlFor="section-body">{selected.title}</label><textarea id="section-body" className={styles.textarea} value={selected.body} onChange={e=>setPromptDraft({...draft,sections:draft.sections.map(s=>s.id===selected.id?{...s,body:e.target.value}:s)})} spellCheck={false}/></> : null}
                <div className={styles.fieldFooter}><span>저장하면 이 캐릭터의 다음 대화부터 적용돼.</span><span>{currentPrompt.length.toLocaleString()} / 30,000자</span></div>
              </div>
            </div>

            <div className={styles.bottomRow}><div className={styles.tip}><span>✦</span> 캐릭터를 바꿔도 다른 캐릭터의 설정과 대화 샘플은 섞이지 않아.</div><div className={styles.bottomButtons}>
              {working.id && <button onClick={()=>void remove()} disabled={saving || imageBusy}><Trash2 size={16}/> 삭제</button>}
              <button onClick={()=>{ if (baseline==="__NEW__") newCharacter(); else { const original=characters.find(c=>c.id===working.id); if(original) applyCharacter(original); } }} disabled={!dirty || saving || imageBusy}><RotateCcw size={16}/> 되돌리기</button>
              <button className={styles.primaryButton} onClick={()=>void save()} disabled={!dirty||saving||imageBusy}><Save size={16}/>{saving?"저장 중…":"변경사항 저장"}</button>
            </div></div>
          </>}

          {(notice||error) && <div role="status" className={`${styles.message} ${error?styles.error:""}`}>{error||notice}</div>}
          <div className={styles.shareRow}><div><Link2 size={17}/><span>이 링크 하나에서 모든 캐릭터를 관리해. 링크는 필요한 사람에게만 공유해 줘.</span></div><button onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{setError("주소창에서 링크를 복사해 줘.");}}}>{copied?<Check size={15}/>:<Link2 size={15}/>} {copied?"복사됨":"링크 복사"}</button></div>
        </>}
      </section>
    </main>
    {!loading && working && <div className={styles.mobileBottom}>
      <a href="/dokyeong-live" target="_blank" rel="noreferrer">라이브 열기 <ChevronRight size={15}/></a>
      <button type="button" disabled={!dirty || saving || imageBusy} onClick={()=>void save()}><Save size={17}/>{saving?"저장 중…":"변경사항 저장"}</button>
    </div>}
  </div>;
}

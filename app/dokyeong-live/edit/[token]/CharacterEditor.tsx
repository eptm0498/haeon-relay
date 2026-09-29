"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleAlert, FileText, Link2, MessageCircle, Plus, RotateCcw, Save, Sparkles } from "lucide-react";
import SampleManager from "./SampleManager";
import styles from "./editor.module.css";

type Section = { id: string; title: string; body: string };
type Draft = { intro: string; sections: Section[] };
type Record = { prompt: string; version: number | null; updated_at: string | null };

const descriptions: { [key: string]: string } = {
  "기본 성격과 관계": "도경의 성격, 관계와 반응의 기본값",
  "호칭과 말투": "호칭, 입말과 채팅 말투의 차이",
  "애정과 장난": "애정 표현과 놀리는 방식",
  "성인 연인 대화와 디그레이더 모드": "친밀한 대화의 조건과 경계",
  "대화 리듬": "답변 길이와 대화의 속도",
  "피해야 할 것": "도경답지 않은 반응과 금지할 습관",
};

function parsePrompt(prompt: string): Draft {
  const headings = [...prompt.matchAll(/^\[([^\]\n]+)\][ \t]*\n/gm)];
  return {
    intro: prompt.slice(0, headings[0]?.index ?? prompt.length).trim(),
    sections: headings.map((match, index) => ({
      id: String(index), title: match[1],
      body: prompt.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? prompt.length).trim(),
    })),
  };
}

function composePrompt(draft: Draft) {
  return [draft.intro.trim(), ...draft.sections.map((section) => `[${section.title.trim()}]\n${section.body.trim()}`)].filter(Boolean).join("\n\n");
}

export default function CharacterEditor({ token }: { token: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [active, setActive] = useState("intro");
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"profile" | "samples">("profile");
  const api = `/api/dokyeong/character/${token}`;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(api, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "편집 링크가 올바르지 않아." : "설정을 불러오지 못했어. 다시 시도해 줘.");
      const data: Record = await response.json();
      setDraft(parsePrompt(data.prompt)); setRaw(data.prompt);
      setBaseline(data.prompt); setVersion(data.version); setUpdatedAt(data.updated_at);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "연결을 확인해 줘."); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);
  const composed = useMemo(() => draft ? composePrompt(draft) : "", [draft]);
  const current = rawMode ? raw : composed;
  const dirty = !!draft && current !== baseline;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changeSection(id: string, body: string) {
    setDraft((value) => value && ({ ...value, sections: value.sections.map((s) => s.id === id ? { ...s, body } : s) }));
    setNotice("");
  }

  function toggleMode() {
    if (rawMode) { setDraft(parsePrompt(raw)); setActive("intro"); }
    else setRaw(composed);
    setRawMode(!rawMode);
  }

  function selectSection(id: string) {
    if (rawMode) setDraft(parsePrompt(raw));
    setActive(id); setRawMode(false);
  }

  async function save() {
    if (!dirty || saving) return;
    if (current.length < 100 || current.length > 30000) { setError("설정은 100~30,000자로 작성해 줘."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(api, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: current, version }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "저장하지 못했어.");
      setBaseline(current); setVersion(data.version); setUpdatedAt(data.updated_at);
      setNotice("저장했어. 다음 대화부터 바로 적용돼.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했어."); }
    finally { setSaving(false); }
  }

  const selected = draft?.sections.find((s) => s.id === active);
  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <div className={styles.brand}><span className={styles.mark}>D.</span><span>도경<span className={styles.brandLight}>LIVE</span><small>CHARACTER STUDIO</small></span></div>
      <div className={styles.topActions}>
        <a className={styles.liveLink} href="/dokyeong-live" target="_blank" rel="noreferrer">라이브 열기 <ChevronRight size={16}/></a>
        {tab === "profile" && <button className={styles.saveTop} disabled={!dirty || saving} onClick={save}><Save size={17}/>{saving ? "저장 중…" : "변경사항 저장"}</button>}
      </div>
    </header>

    <main className={styles.main}>
      <aside className={styles.sidebar}>
        <div className={styles.sideHeading}>도경의 설정 <span>{draft?.sections.length ?? 0}개 항목</span></div>
        <nav className={styles.nav} aria-label="설정 항목">
          <button className={`${styles.navItem} ${tab === "samples" ? styles.navActive : ""}`} onClick={() => setTab("samples")}><MessageCircle size={17}/> 대화 샘플</button>
          <div className={styles.navDivider}/>
          <button className={`${styles.navItem} ${tab === "profile" && active === "intro" ? styles.navActive : ""}`} onClick={() => {setTab("profile");selectSection("intro");}}><Sparkles size={17}/> 기본 설정</button>
          {draft?.sections.map((s) => <button key={s.id} className={`${styles.navItem} ${tab === "profile" && active === s.id ? styles.navActive : ""}`} onClick={() => {setTab("profile");selectSection(s.id);}}><span className={styles.navDot}/><span className={styles.navLabel}>{s.title}</span></button>)}
        </nav>
        {tab === "profile" && <button className={styles.addButton} onClick={() => { const id = `new-${Date.now()}`; setDraft((value) => { const base = rawMode ? parsePrompt(raw) : value; return base && ({...base, sections: [...base.sections, { id, title: "새 특징", body: "" }]}); }); setActive(id); setRawMode(false); }}><Plus size={17}/> 특징 추가</button>}
        <div className={styles.sideBottom}><span className={styles.statusDot}/> 저장하면 다음 대화에 적용돼<br/><span className={styles.date}>{updatedAt ? `마지막 저장 ${new Date(updatedAt).toLocaleString("ko-KR")}` : "아직 직접 수정한 내용이 없어"}</span></div>
      </aside>

      <section className={styles.content}>
        <div className={styles.eyebrow}>DOKYEONG LIVE <ChevronRight size={13}/> CHARACTER</div>
        <div className={styles.titleRow}><div><h1>도경 설정실<span className={styles.titleStar}>✳</span></h1><p>말투부터 실제 대화 샘플까지. 저장하면 도경의 다음 응답부터 반영돼.</p></div><div className={styles.badge}>● LIVE SETTINGS</div></div>
        <div className={styles.tabs} role="tablist" aria-label="도경 설정 메뉴"><button role="tab" aria-selected={tab === "profile"} className={tab === "profile" ? styles.tabActive : ""} onClick={() => setTab("profile")}><Sparkles size={16}/> 캐릭터 설정</button><button role="tab" aria-selected={tab === "samples"} className={tab === "samples" ? styles.tabActive : ""} onClick={() => setTab("samples")}><MessageCircle size={16}/> 대화 샘플</button></div>

        {tab === "samples" ? <SampleManager token={token}/> : loading ? <div className={styles.centerState}>설정을 불러오는 중…</div> : !draft ? <div className={styles.centerState}><CircleAlert size={26}/>{error}<button onClick={() => void load()}>다시 시도</button></div> : <>
          <div className={styles.mobileNav}><label htmlFor="section-select">편집할 항목</label><select id="section-select" value={active} onChange={(event) => selectSection(event.target.value)}><option value="intro">기본 설정</option>{draft.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
          <div className={styles.editorCard}>
            <div className={styles.cardHeader}><div className={styles.cardIcon}>{rawMode ? <FileText size={23}/> : active === "intro" ? <Sparkles size={23}/> : <span>✳</span>}</div><div className={styles.cardTitles}><span className={styles.overline}>CHARACTER PROFILE / {String(active === "intro" ? 1 : draft.sections.findIndex((s) => s.id === active) + 2).padStart(2,"0")}</span><h2>{rawMode ? "전체 원문 편집" : active === "intro" ? "기본 설정" : selected?.title}</h2><p>{rawMode ? "모든 지침을 한 번에 수정할 수 있어." : active === "intro" ? "도경과 형의 관계, 대화의 출발점을 정해 줘." : descriptions[selected?.title || ""] || "도경에게 새롭게 알려줄 특징을 적어 줘."}</p></div><button className={styles.modeButton} onClick={toggleMode}>{rawMode ? "항목별 편집" : "전체 원문"}</button></div>
            <div className={styles.fieldArea}>
              {rawMode ? <><label htmlFor="raw-prompt">전체 지침</label><textarea id="raw-prompt" className={`${styles.textarea} ${styles.rawArea}`} value={raw} onChange={(event) => {setRaw(event.target.value); setNotice("");}} spellCheck={false}/></> : active === "intro" ? <><label htmlFor="intro">기본 역할과 관계</label><textarea id="intro" className={styles.textarea} value={draft.intro} onChange={(event) => setDraft({...draft, intro: event.target.value})} spellCheck={false}/></> : selected ? <>{selected.id.startsWith("new-") && <div className={styles.nameField}><label htmlFor="section-name">특징 이름</label><input id="section-name" value={selected.title} onChange={(event) => setDraft({...draft, sections: draft.sections.map((s) => s.id === selected.id ? {...s, title: event.target.value.replace(/[\[\]\n]/g, "")} : s)})}/></div>}<label htmlFor="section-body">도경에게 적용할 내용</label><textarea key={selected.id} id="section-body" className={styles.textarea} value={selected.body} onChange={(event) => changeSection(selected.id, event.target.value)} spellCheck={false}/>{selected.id.startsWith("new-") && <button className={styles.removeButton} onClick={() => {setDraft({...draft, sections: draft.sections.filter((s) => s.id !== selected.id)}); setActive("intro");}}>이 특징 삭제</button>}</> : null}
              <div className={styles.fieldFooter}><span>도경이 실제 통화에서 사용할 말로 구체적으로 적으면 좋아.</span><span>{current.length.toLocaleString()} / 30,000자</span></div>
            </div>
          </div>

          <div className={styles.bottomRow}><div className={styles.tip}><span>✦</span> 저장한 내용은 이전 대화 기록을 바꾸지 않고, 다음 응답부터 적용돼.</div><div className={styles.bottomButtons}><button onClick={() => { if (!dirty || window.confirm("저장하지 않은 변경사항을 버릴까?")) { setDraft(parsePrompt(baseline)); setRaw(baseline); setNotice(""); setError(""); } }} disabled={!dirty}><RotateCcw size={16}/> 되돌리기</button><button className={styles.primaryButton} onClick={save} disabled={!dirty || saving}><Save size={16}/>{saving ? "저장 중…" : "변경사항 저장"}</button></div></div>
          {(notice || error) && <div role="status" className={`${styles.message} ${error ? styles.error : ""}`}>{error || notice}</div>}
          <div className={styles.shareRow}><div><Link2 size={17}/><span>이 페이지의 링크를 가진 사람이 수정할 수 있어. 링크는 필요한 사람에게만 공유해 줘.</span></div><button onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError("주소창에서 링크를 복사해 줘."); } }}>{copied ? <Check size={15}/> : <Link2 size={15}/>} {copied ? "복사됨" : "링크 복사"}</button></div>
        </>}
      </section>
    </main>
    {tab === "profile" && <div className={styles.mobileBottom}><a href="/dokyeong-live"><ArrowLeft size={16}/> 라이브</a><button disabled={!dirty || saving} onClick={save}><Save size={17}/>{saving ? "저장 중…" : "변경사항 저장"}</button></div>}
  </div>;
}

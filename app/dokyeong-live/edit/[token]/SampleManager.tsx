"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileUp, Plus, Search, Trash2, X } from "lucide-react";
import styles from "./samples.module.css";

type Sample = {
  id?: string; cue: string; reply: string; spoken: string;
  category: string; quality?: number; enabled: boolean; updated_at?: string;
};
type Preview = { parsed: number; paired: number; extracted: number; active: number; preview: Sample[] };
const categories = ["일상", "장난", "애정", "위로", "갈등", "생각", "잠/생활", "기타"];
const blank: Sample = { cue: "", reply: "", spoken: "", category: "일상", enabled: true };

function fileSpeakers(text: string) {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2}, ([^:\n]{1,40}) : /);
    if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return [...counts].sort((a,b) => b[1]-a[1]).map(([name,count]) => ({name,count}));
}

export default function SampleManager({ token, characterId, characterName }: { token: string; characterId: string; characterName: string }) {
  const baseApi = `/api/dokyeong/character/${token}/samples`;
  const api = `${baseApi}?character=${encodeURIComponent(characterId)}`;
  const importApi = `${baseApi}/import?character=${encodeURIComponent(characterId)}`;
  const [items, setItems] = useState<Sample[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Sample | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [speakers, setSpeakers] = useState<{name:string;count:number}[]>([]);
  const [speaker, setSpeaker] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async (p: number, q: string, f: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${api}&page=${p}&q=${encodeURIComponent(q)}&filter=${f}`, {cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "대화 샘플을 불러오지 못했어.");
      setItems(data.items); setTotal(data.total);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "연결을 확인해 줘."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(page, search, filter); }, [load, page, search, filter]);

  async function inspectFile(value: string, target: string) {
    if (!value || !target) return;
    setBusy(true); setError(""); setPreview(null);
    try {
      const response = await fetch(importApi, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({text:value, speaker:target, preview:true}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "파일을 분석하지 못했어.");
      setPreview(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 확인해 줘."); }
    finally { setBusy(false); }
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    setError(""); setNotice(""); setPreview(null);
    if (file.size > 3_000_000) { setError("3MB 이하의 카카오톡 대화 텍스트를 올려 줘."); return; }
    const text = await file.text();
    const found = fileSpeakers(text);
    if (!found.length) { setError("카카오톡 대화 내보내기 형식을 읽지 못했어."); return; }
    const target = found.find((item) => item.name === characterName)?.name || found[0].name;
    setFileName(file.name); setFileText(text); setSpeakers(found); setSpeaker(target);
    await inspectFile(text, target);
  }

  async function importFile() {
    if (!preview || !fileText) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(importApi, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({text:fileText, speaker, preview:false}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "파일을 가져오지 못했어.");
      setNotice(`${data.added.toLocaleString()}개 추가했어. 중복 ${data.duplicates.toLocaleString()}개는 건너뛰었어.`);
      setFileText(""); setFileName(""); setPreview(null); setSpeakers([]); setPage(0); setSearch(""); setQuery("");
      await load(0, "", filter);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 가져오지 못했어."); }
    finally { setBusy(false); }
  }

  async function saveSample() {
    if (!editing || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(api, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(editing) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "샘플을 저장하지 못했어.");
      setEditing(null); setNotice("샘플을 저장했어. 다음 대화부터 적용돼.");
      await load(page, search, filter);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "샘플을 확인해 줘."); }
    finally { setBusy(false); }
  }

  async function removeSample(item: Sample) {
    if (!item.id || !window.confirm("이 대화 샘플을 삭제할까?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${api}&id=${item.id}`, {method:"DELETE"});
      if (!response.ok) throw new Error("삭제하지 못했어.");
      setNotice("샘플을 삭제했어."); await load(page, search, filter);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했어."); }
    finally { setBusy(false); }
  }

  async function toggle(item: Sample) {
    setBusy(true); setError("");
    try {
      const response = await fetch(api, {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...item,enabled:!item.enabled})});
      if (!response.ok) throw new Error("적용 상태를 바꾸지 못했어.");
      await load(page, search, filter);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "다시 시도해 줘."); }
    finally { setBusy(false); }
  }

  return <div className={styles.root}>
    <div className={styles.summary}><div><h2>대화 샘플 <span>{total.toLocaleString()}</span></h2><p>과거 대화의 반응 방식을 참고해. 꺼 둔 샘플은 통화에 사용하지 않아.</p></div><button className={styles.add} onClick={() => setEditing({...blank})}><Plus size={16}/> 직접 추가</button></div>

    <div className={styles.upload}>
      <div className={styles.uploadTitle}><FileUp size={19}/><div><strong>카카오톡 대화 가져오기</strong><span>텍스트 파일을 분석한 뒤 캐릭터의 대답을 샘플로 저장해.</span></div></div>
      <label className={styles.fileButton}>파일 선택<input type="file" accept=".txt,text/plain" onChange={(event) => void chooseFile(event.target.files?.[0])}/></label>
      {fileName && <div className={styles.fileDetails}><span className={styles.filename}>{fileName}</span><label>캐릭터의 대화명 <select value={speaker} onChange={(event) => {setSpeaker(event.target.value); void inspectFile(fileText, event.target.value);}}>{speakers.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.count.toLocaleString()}건</option>)}</select></label></div>}
      {busy && <div className={styles.smallStatus}>분석하거나 저장하는 중…</div>}
      {preview && <div className={styles.preview}><div><strong>{preview.extracted.toLocaleString()}개 추출</strong><span>이 중 {preview.active.toLocaleString()}개가 통화에 사용돼. 나머지는 보관해 두고 직접 켤 수 있어.</span></div><button onClick={() => void importFile()} disabled={busy}>샘플 가져오기</button><details><summary>추출 예시 보기</summary>{preview.preview.map((item, index) => <p key={index}><b>형</b> {item.cue}<br/><b>{characterName}</b> {item.spoken}</p>)}</details></div>}
    </div>

    <form className={styles.toolbar} onSubmit={(event) => {event.preventDefault(); setPage(0); setSearch(query);}}><div className={styles.searchBox}><Search size={16}/><input aria-label="샘플 검색" placeholder="대화 내용이나 분류 검색" value={query} onChange={(event) => setQuery(event.target.value)}/></div><select aria-label="사용 상태" value={filter} onChange={(event) => {setPage(0); setFilter(event.target.value);}}><option value="all">전체</option><option value="on">사용 중</option><option value="off">꺼짐</option></select><button type="submit">검색</button></form>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status"><Check size={15}/>{notice}</div>}
    {loading ? <div className={styles.empty}>불러오는 중…</div> : items.length === 0 ? <div className={styles.empty}>해당하는 샘플이 없어. 검색 조건을 바꾸거나 직접 추가해 줘.</div> : <div className={styles.list}>{items.map((item) => <article key={item.id} className={`${styles.sample} ${!item.enabled ? styles.off : ""}`}><div className={styles.sampleTop}><span className={styles.category}>{item.category}</span><span className={styles.quality}>품질 {item.quality ?? 50}</span><span className={styles.state}>{item.enabled ? "● 사용 중" : "○ 꺼짐"}</span></div><p><b>형</b> {item.cue}</p><p><b>{characterName}</b> {item.spoken}</p><div className={styles.sampleActions}><button onClick={() => setEditing({...item})}>수정</button><button onClick={() => void toggle(item)} disabled={busy}>{item.enabled ? "끄기" : "켜기"}</button><button className={styles.danger} onClick={() => void removeSample(item)} disabled={busy} aria-label="샘플 삭제"><Trash2 size={15}/></button></div></article>)}</div>}
    {total > 40 && <div className={styles.pages}><button disabled={page === 0} onClick={() => setPage(page-1)}><ChevronLeft size={16}/> 이전</button><span>{page+1} / {Math.ceil(total/40)}</span><button disabled={(page+1)*40 >= total} onClick={() => setPage(page+1)}>다음 <ChevronRight size={16}/></button></div>}

    {editing && <div className={styles.modalBackdrop} onMouseDown={(event) => {if(event.target === event.currentTarget && !busy) setEditing(null);}}><div className={styles.modal} role="dialog" aria-modal="true" aria-label="대화 샘플 수정"><div className={styles.modalHead}><h3>{editing.id ? "대화 샘플 수정" : "대화 샘플 추가"}</h3><button onClick={() => setEditing(null)} aria-label="닫기"><X size={19}/></button></div><div className={styles.modalBody}><label>형의 말<textarea value={editing.cue} onChange={(event) => setEditing({...editing,cue:event.target.value})} maxLength={700}/></label><label>원래 캐릭터의 답변<textarea value={editing.reply} onChange={(event) => setEditing({...editing,reply:event.target.value})} maxLength={900}/></label><label>음성에서 사용할 자연스러운 말<textarea value={editing.spoken} onChange={(event) => setEditing({...editing,spoken:event.target.value})} maxLength={900}/></label><div className={styles.formRow}><label>상황 분류<select value={editing.category} onChange={(event) => setEditing({...editing,category:event.target.value})}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label><label className={styles.check}><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({...editing,enabled:event.target.checked})}/> 통화에 사용</label></div><p className={styles.hint}>원문은 기록용이야. 실제 통화에는 ‘음성에서 사용할 말’을 참고해.</p></div><div className={styles.modalActions}><button onClick={() => setEditing(null)}>취소</button><button disabled={busy || editing.cue.length<2 || !editing.reply || !editing.spoken} onClick={() => void saveSample()}>{busy ? "저장 중…" : "저장하기"}</button></div></div></div>}
  </div>;
}

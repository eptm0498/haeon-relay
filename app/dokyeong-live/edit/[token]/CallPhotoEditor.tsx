"use client";

import { useEffect, useId, useState } from "react";
import { isStandaloneJiwoo, JIWOO_MAX_CALL_PHOTOS } from "@/lib/dokyeong/character-modes";
import { MAX_CALL_PHOTO_LENGTH, MAX_CALL_PHOTOS, MAX_CALL_SITUATION_LENGTH, type CallPhoto, type PhotoDays, type PhotoDetails, type PhotoUse } from "@/lib/dokyeong/call-scenes";
import { DEFAULT_PHOTO_DETAILS, JIWOO_ALBUM_TAGS, parsePhotoTags, validPhotoDetails } from "@/lib/dokyeong/jiwoo-album";
import styles from "./editor.module.css";

const example = "예: 자기 전에 누워서 조용히 얘기할 때";
type DetailsDraft = Omit<PhotoDetails, "tags"> & { tags: string };
type PendingPhoto = { file: File; id?: string };
const photoDraft = (photo?: CallPhoto): DetailsDraft => ({
  useFor: photo?.useFor ?? DEFAULT_PHOTO_DETAILS.useFor,
  startTime: photo?.startTime ?? "",
  endTime: photo?.endTime ?? "",
  days: photo?.days ?? DEFAULT_PHOTO_DETAILS.days,
  tags: photo?.tags?.join(", ") ?? "",
});
const photoDetails = (draft: DetailsDraft): PhotoDetails => ({ ...draft, tags: parsePhotoTags(draft.tags) });
const photoUses = { call: "통화 화면", chat: "채팅에서 보내기", both: "채팅과 통화" };

function AlbumFields({ draft, disabled, onChange, suggestions = false }: {
  draft: DetailsDraft; disabled: boolean; onChange: (draft: DetailsDraft) => void; suggestions?: boolean;
}) {
  const id = useId();
  const tags = parsePhotoTags(draft.tags);
  return <fieldset className={styles.albumFields} disabled={disabled}>
    <legend className={styles.srOnly}>사진 태그와 표시 설정</legend>
    <label htmlFor={`${id}-tags`}>태그</label>
    <input id={`${id}-tags`} type="text" value={draft.tags} placeholder="기상, 침대, 아침 햇빛" maxLength={192}
      onChange={event => onChange({ ...draft, tags: event.target.value })} />
    {suggestions && <div className={styles.albumTags}>
      {JIWOO_ALBUM_TAGS.map(tag => <button key={tag} type="button" className={styles.modeButton} aria-pressed={tags.includes(tag)}
        disabled={tags.length >= 8 && !tags.includes(tag)}
        onClick={() => onChange({ ...draft, tags: (tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag]).join(", ") })}>{tag}</button>)}
    </div>}
    <label htmlFor={`${id}-use`}>사용할 곳</label>
    <select id={`${id}-use`} value={draft.useFor} onChange={event => {
      const useFor = event.target.value as PhotoUse;
      onChange(useFor === "chat" ? { ...draft, useFor, startTime: "", endTime: "" } : { ...draft, useFor });
    }}>
      {Object.entries(photoUses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>
    {draft.useFor !== "chat" && <div className={styles.albumSchedule}>
      <label>표시 요일<select value={draft.days} onChange={event => onChange({ ...draft, days: event.target.value as PhotoDays })}>
        <option value="daily">매일</option><option value="weekdays">평일</option><option value="weekend">주말</option>
      </select></label>
      <label>시작 시간<input type="time" value={draft.startTime} onChange={event => onChange({ ...draft, startTime: event.target.value })} /></label>
      <label>종료 시간<input type="time" value={draft.endTime} onChange={event => onChange({ ...draft, endTime: event.target.value })} /></label>
      <p>한국 시간 기준이야. 시간을 비워 두면 대화에 맞을 때만 나와.</p>
    </div>}
  </fieldset>;
}

async function preparePhoto(file: File) {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) throw new Error("25MB 이하의 사진을 골라 줘.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error("사진을 읽지 못했어. JPG나 PNG로 다시 골라 줘."); });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("사진을 준비하지 못했어.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.89, 0.8, 0.7, 0.6, 0.5]) {
      const data = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      if (data && data.length <= MAX_CALL_PHOTO_LENGTH) return data;
    }
    throw new Error("사진이 너무 커. 다른 사진을 골라 줘.");
  } finally { URL.revokeObjectURL(url); }
}

function PhotoRow({ photo, src, busy, album, onSave, onReplace, onRemove }: {
  photo: CallPhoto; src: string; busy: boolean; album: boolean; onSave: (situation: string, details?: PhotoDetails) => void; onReplace: (file?: File) => void; onRemove: () => void;
}) {
  const [situation, setSituation] = useState(photo.situation);
  const [draft, setDraft] = useState(() => photoDraft(photo));
  const details = photoDetails(draft);
  const changed = situation.trim() !== photo.situation || JSON.stringify(draft) !== JSON.stringify(photoDraft(photo));
  const fields = <div className={album ? styles.albumPhotoEdit : undefined}>
      <label htmlFor={`situation-${photo.id}`}>사진이 나올 상황</label>
      <textarea id={`situation-${photo.id}`} rows={2} maxLength={MAX_CALL_SITUATION_LENGTH} value={situation} disabled={busy} onChange={event => setSituation(event.target.value)} />
      {album && <AlbumFields draft={draft} disabled={busy} onChange={setDraft} />}
      <div className={styles.callPhotoActions}>
        <button type="button" className={styles.modeButton} disabled={busy || !situation.trim() || !changed || (album && !validPhotoDetails(details))}
          onClick={() => onSave(situation, album ? details : undefined)}>{album ? "사진 설정 저장" : "상황 저장"}</button>
        <label className={styles.modeButton}>사진 교체<input type="file" accept="image/*" disabled={busy} onChange={event => { onReplace(event.target.files?.[0]); event.target.value = ""; }}/></label>
        <button type="button" className={styles.modeButton} disabled={busy} onClick={onRemove}>사진 삭제</button>
      </div>
    </div>;
  return <article className={styles.callPhotoRow}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} loading="lazy" alt={photo.situation} />
    {album ? <details className={styles.albumPhotoDetails}>
      <summary>
        <strong>{photo.situation}</strong>
        <small>{photoUses[photo.useFor ?? "call"]}{photo.startTime && ` · ${photo.startTime}~${photo.endTime}`} · 편집</small>
        {photo.tags?.length ? <span>{photo.tags.map(tag => `#${tag}`).join(" ")}</span> : null}
      </summary>
      {fields}
    </details> : fields}
  </article>;
}

export default function CallPhotoEditor({ api, characterId }: { api: string; characterId: string }) {
  const album = isStandaloneJiwoo(characterId);
  const limit = album ? JIWOO_MAX_CALL_PHOTOS : MAX_CALL_PHOTOS;
  const endpoint = `${api}/call-photos`;
  const listUrl = `${endpoint}?characterId=${characterId}`;
  const [photos, setPhotos] = useState<CallPhoto[] | null>(null);
  const [files, setFiles] = useState<PendingPhoto[]>([]);
  const [preview, setPreview] = useState("");
  const [situation, setSituation] = useState("");
  const [draft, setDraft] = useState<DetailsDraft>(() => photoDraft());
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState("");
  const [visibleCount, setVisibleCount] = useState(16);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [photoRevision, setPhotoRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(listUrl, { signal: abort.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result)) throw new Error(result.error || "통화 사진을 불러오지 못했어.");
        setPhotos(result);
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "통화 사진을 불러오지 못했어.");
      }
    })();
    return () => abort.abort();
  }, [listUrl, retry]);

  async function pick(selected: File[]) {
    if (!selected.length || busy) return;
    setBusy(true); setNotice(""); setError("");
    try {
      if (selected.length > limit - (photos?.length ?? 0)) throw new Error("앨범에 남은 자리보다 많은 사진을 골랐어.");
      setPreview(await preparePhoto(selected[0]));
      setFiles(selected.map(file => ({ file, id: album ? crypto.randomUUID() : undefined })));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "사진을 준비하지 못했어."); }
    finally { setBusy(false); }
  }

  async function send(action: string, photoId?: string, description?: string, image?: string, details?: PhotoDetails) {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, characterId, photoId, situation: description, image, details }),
    });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result)) throw new Error(result.error || "사진을 저장하지 못했어.");
    setPhotos(result);
  }

  async function save(action: "edit" | "replace" | "delete", photoId: string, description?: string, file?: File, details?: PhotoDetails) {
    if (busy) return;
    setBusy(true); setNotice(""); setError("");
    try {
      await send(action, photoId, description, file ? await preparePhoto(file) : undefined, details);
      if (action === "replace") setPhotoRevision(value => value + 1);
      setNotice(action === "delete" ? "사진을 삭제했어." : "저장했어.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "통화 사진을 저장하지 못했어."); }
    finally { setBusy(false); }
  }

  async function add() {
    if (busy || !files.length) return;
    setBusy(true); setNotice(""); setError("");
    let saved = 0;
    try {
      for (const [index, item] of files.entries()) {
        await send("add", item.id, situation, index === 0 && preview ? preview : await preparePhoto(item.file), album ? photoDetails(draft) : undefined);
        saved++;
        setFiles(files.slice(saved));
        setNotice(`${saved}/${files.length}장 저장했어.`);
      }
      setPreview(""); setSituation(""); setDraft(photoDraft());
    } catch (cause) {
      if (saved) setPreview("");
      setError(cause instanceof Error ? cause.message : "사진을 저장하지 못했어.");
    } finally { setBusy(false); }
  }

  const title = album ? "사진 앨범" : "통화 사진";
  const filtered = photos?.filter(photo => {
    const match = search.trim().toLowerCase();
    const purpose = photo.useFor ?? "call";
    return (!usage || purpose === usage || purpose === "both") &&
      (!match || [photo.situation, ...(photo.tags ?? [])].join(" ").toLowerCase().includes(match));
  }) ?? [];
  const visible = album ? filtered.slice(0, visibleCount) : filtered;
  return <section className={`${styles.editorCard} ${styles.callPhotoCard}`} aria-label={title}>
    <div className={styles.cardHeader}>
      <div className={styles.cardTitles}><h2>{title}</h2><p>{album ? "채팅에 허용한 사진은 요청받았을 때도, 지우가 먼저 보낼 때도 태그와 대화에 맞춰 골라. 통화에 허용한 사진은 대화와 지정한 시간대에 따라 화면에 나와." : "기본은 프로필 사진이야. 대화가 아래에 적어둔 상황과 맞으면 해당 사진으로 바뀌어."}</p></div>
      {photos && <span className={styles.callPhotoCount}>{photos.length}/{limit}</span>}
    </div>
    <div className={styles.fieldArea}>
      {error && <p role="alert" className={styles.photoError}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!photos && (error ? <button type="button" className={styles.modeButton} onClick={() => { setError(""); setRetry(n => n + 1); }}>다시 불러오기</button> : <p role="status">통화 사진을 불러오는 중…</p>)}
      {photos && photos.length < limit && <div className={styles.callPhotoNew}>
        <label htmlFor="new-call-photo">{album ? "앨범 사진 추가" : "통화 사진 추가"}</label>
        <input id="new-call-photo" type="file" multiple={album} accept="image/*" disabled={busy} onChange={event => { void pick(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        {files.length > 0 && <div className={styles.callPhotoRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={`data:image/jpeg;base64,${preview}`} alt="첫 사진 미리보기" /> : <span />}
          <div>
            {files.length > 1 && <p>{files.length}장에 아래 설정을 함께 적용해.</p>}
            <label htmlFor="new-call-situation">이 사진이 나올 상황</label>
            <textarea id="new-call-situation" rows={2} maxLength={MAX_CALL_SITUATION_LENGTH} placeholder={example} value={situation} disabled={busy} onChange={event => setSituation(event.target.value)} />
            {album && <AlbumFields draft={draft} onChange={setDraft} disabled={busy} suggestions />}
            <div className={styles.callPhotoActions}>
              <button type="button" className={styles.primaryButton} disabled={busy || !situation.trim() || (album && !validPhotoDetails(photoDetails(draft)))}
                onClick={() => void add()}>{busy ? "처리 중…" : `${files.length}장 등록`}</button>
              <button type="button" className={styles.modeButton} disabled={busy} onClick={() => { setFiles([]); setPreview(""); setSituation(""); setDraft(photoDraft()); }}>취소</button>
            </div>
          </div>
        </div>}
      </div>}
      {album && photos && <div className={styles.albumFilters}>
        <label>태그·설명 검색<input type="search" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(16); }} /></label>
        <label>사용할 곳<select value={usage} onChange={event => { setUsage(event.target.value); setVisibleCount(16); }}>
          <option value="">모두</option>{Object.entries(photoUses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
      </div>}
      {photos && !visible.length && <p>{photos.length ? "검색에 맞는 사진이 없어." : "아직 등록된 사진이 없어."}</p>}
      {visible.map(photo => <PhotoRow key={JSON.stringify(photo)} photo={photo} src={`${listUrl}&photoId=${photo.id}&v=${photoRevision}`} busy={busy} album={album}
        onSave={(description, details) => void save("edit", photo.id, description, undefined, details)}
        onReplace={file => { if (file) void save("replace", photo.id, undefined, file); }}
        onRemove={() => { if (window.confirm("이 사진을 앨범에서 삭제할까?")) void save("delete", photo.id); }} />)}
      {album && visible.length < filtered.length && <button type="button" className={styles.modeButton}
        onClick={() => setVisibleCount(count => count + 16)}>사진 더 보기 ({visible.length}/{filtered.length})</button>}
    </div>
  </section>;
}

"use client";

import { useEffect, useState } from "react";
import { MAX_CALL_PHOTO_LENGTH, MAX_CALL_PHOTOS, MAX_CALL_SITUATION_LENGTH, type CallPhoto } from "@/lib/dokyeong/call-scenes";
import styles from "./editor.module.css";

const example = "예: 자기 전에 누워서 조용히 얘기할 때";

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

function PhotoRow({ photo, src, busy, onSave, onRemove }: {
  photo: CallPhoto; src: string; busy: boolean; onSave: (situation: string) => void; onRemove: () => void;
}) {
  const [situation, setSituation] = useState(photo.situation);
  return <article className={styles.callPhotoRow}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} loading="lazy" alt="저장된 통화 사진" />
    <div>
      <label htmlFor={`situation-${photo.id}`}>사진이 나올 상황</label>
      <textarea id={`situation-${photo.id}`} rows={2} maxLength={MAX_CALL_SITUATION_LENGTH} value={situation} disabled={busy} onChange={event => setSituation(event.target.value)} />
      <div className={styles.callPhotoActions}>
        <button type="button" className={styles.modeButton} disabled={busy || !situation.trim() || situation.trim() === photo.situation} onClick={() => onSave(situation)}>상황 저장</button>
        <button type="button" className={styles.modeButton} disabled={busy} onClick={onRemove}>사진 삭제</button>
      </div>
    </div>
  </article>;
}

export default function CallPhotoEditor({ api, characterId }: { api: string; characterId: string }) {
  const endpoint = `${api}/call-photos`;
  const listUrl = `${endpoint}?characterId=${characterId}`;
  const [photos, setPhotos] = useState<CallPhoto[] | null>(null);
  const [image, setImage] = useState("");
  const [situation, setSituation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

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

  async function pick(file?: File) {
    if (!file || busy) return;
    setBusy(true); setNotice(""); setError("");
    try { setImage(await preparePhoto(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "사진을 준비하지 못했어."); }
    finally { setBusy(false); }
  }

  async function save(action: "add" | "edit" | "delete", photoId?: string, description?: string) {
    if (busy) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, characterId, photoId, situation: description, image: action === "add" ? image : undefined }),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result)) throw new Error(result.error || "통화 사진을 저장하지 못했어.");
      setPhotos(result);
      if (action === "add") { setImage(""); setSituation(""); }
      setNotice(action === "delete" ? "사진을 삭제했어." : "저장했어. 다음 음성 답변부터 적용돼.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "통화 사진을 저장하지 못했어."); }
    finally { setBusy(false); }
  }

  return <section className={`${styles.editorCard} ${styles.callPhotoCard}`} aria-label="통화 사진">
    <div className={styles.cardHeader}>
      <div className={styles.cardTitles}><span className={styles.overline}>VOICE CALL</span><h2>통화 사진</h2><p>기본은 프로필 사진이야. 대화가 아래에 적어둔 상황과 맞으면 해당 사진으로 바뀌어.</p></div>
      {photos && <span className={styles.callPhotoCount}>{photos.length}/{MAX_CALL_PHOTOS}</span>}
    </div>
    <div className={styles.fieldArea}>
      {error && <p role="alert" className={styles.photoError}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!photos && (error ? <button type="button" className={styles.modeButton} onClick={() => { setError(""); setRetry(n => n + 1); }}>다시 불러오기</button> : <p role="status">통화 사진을 불러오는 중…</p>)}
      {photos?.map(photo => <PhotoRow key={`${photo.id}:${photo.situation}`} photo={photo} src={`${listUrl}&photoId=${photo.id}`} busy={busy}
        onSave={description => void save("edit", photo.id, description)} onRemove={() => { if (window.confirm("이 통화 사진을 삭제할까?")) void save("delete", photo.id); }} />)}
      {photos && photos.length < MAX_CALL_PHOTOS && <div className={styles.callPhotoNew}>
        <label htmlFor="new-call-photo">통화 사진 추가</label>
        <input id="new-call-photo" type="file" accept="image/*" disabled={busy} onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} />
        {image && <div className={styles.callPhotoRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/jpeg;base64,${image}`} alt="추가할 사진 미리보기" />
          <div>
            <label htmlFor="new-call-situation">이 사진이 나올 상황</label>
            <textarea id="new-call-situation" rows={2} maxLength={MAX_CALL_SITUATION_LENGTH} placeholder={example} value={situation} disabled={busy} onChange={event => setSituation(event.target.value)} />
            <div className={styles.callPhotoActions}>
              <button type="button" className={styles.primaryButton} disabled={busy || !situation.trim()} onClick={() => void save("add", undefined, situation)}>{busy ? "처리 중…" : "사진과 상황 저장"}</button>
              <button type="button" className={styles.modeButton} disabled={busy} onClick={() => { setImage(""); setSituation(""); }}>취소</button>
            </div>
          </div>
        </div>}
        <p>세로 사진을 쓰면 휴대폰 화면에 자연스럽게 맞아. 사진마다 한 가지 상황을 구체적으로 적어 줘.</p>
      </div>}
    </div>
  </section>;
}

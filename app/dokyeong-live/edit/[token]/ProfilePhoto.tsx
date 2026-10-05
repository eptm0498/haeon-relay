"use client";

import { useEffect, useRef, useState } from "react";
import { dokyeongFaceDataUrl } from "../../dokyeong-face";
import styles from "./editor.module.css";

async function preparePhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해 줘.");
  if (file.size > 25 * 1024 * 1024) throw new Error("25MB 이하의 사진을 선택해 줘.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("사진을 읽지 못했어. JPG나 PNG로 다시 선택해 줘."));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 384;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("사진을 처리하지 못했어.");
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 384, 384);
    ctx.drawImage(image, (image.naturalWidth-size)/2, (image.naturalHeight-size)/2, size, size, 0, 0, 384, 384);
    for (const quality of [0.85, 0.72, 0.58, 0.45]) {
      const photo = canvas.toDataURL("image/jpeg", quality);
      if (photo.length <= 200000) return photo;
    }
    throw new Error("사진이 너무 커. 다른 사진을 선택해 줘.");
  } finally { URL.revokeObjectURL(url); }
}

export default function ProfilePhoto({ name, value, disabled, onChange }: {
  name: string; value: string | null; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const photo = value || (name === "도경" ? dokyeongFaceDataUrl : null);
  async function pick(file?: File) {
    if (!file) return;
    const turn = ++generation.current;
    setBusy(true); setError("");
    try {
      const result = await preparePhoto(file);
      if (turn === generation.current) { setFailed(false); onChange(result); }
    } catch (cause) {
      if (turn === generation.current) setError(cause instanceof Error ? cause.message : "사진을 처리하지 못했어.");
    } finally { if (turn === generation.current) setBusy(false); }
  }
  return <div className={styles.photoSection}>
    <label>프로필 사진</label>
    <div className={styles.photoRow}>
      <div className={styles.photoPreview}>
        {photo && !failed ? <img src={photo} alt={name + " 프로필 미리보기"} onError={() => setFailed(true)}/> : <span>{name.slice(0,2)}</span>}
      </div>
      <div className={styles.photoActions}>
        <input ref={picker} type="file" accept="image/*" hidden onChange={event => { void pick(event.target.files?.[0]); event.target.value=""; }}/>
        <button type="button" className={styles.modeButton} disabled={busy || disabled} onClick={() => picker.current?.click()}>{busy ? "사진 처리 중…" : "사진 선택 / 변경"}</button>
        {value && <button type="button" className={styles.modeButton} disabled={busy || disabled} onClick={() => { setFailed(false); onChange(null); }}>사진 삭제</button>}
        <p>사진 중앙을 정사각형으로 맞춰. 변경사항을 저장하면 채팅 목록과 대화방에 적용돼.</p>
      </div>
    </div>
    {error && <p role="alert" className={styles.photoError}>{error}</p>}
    <details className={styles.photoUrl}><summary>이미지 주소로 설정</summary>
      <input aria-label="프로필 이미지 URL" type="url" placeholder="https://..." disabled={disabled || busy} value={value?.startsWith("data:") ? "" : value || ""} maxLength={2000}
        onChange={event => { setFailed(false); onChange(event.target.value || null); }}/>
    </details>
  </div>;
}

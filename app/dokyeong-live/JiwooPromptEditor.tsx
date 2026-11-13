"use client";

import { useState, type FormEvent } from "react";
import styles from "./live.module.css";

type PromptSettings = { prompt: string; version: number };
const endpoint = "/api/dokyeong/jiwoo-settings";

export default function JiwooPromptEditor() {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (busy || settings) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "지우 설정을 불러오지 못했어.");
      setSettings(data);
      setPrompt(data.prompt);
    } catch (error) {
      setError(error instanceof Error ? error.message : "지우 설정을 불러오지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy || prompt === settings.prompt) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, version: settings.version }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "지우 설정을 저장하지 못했어.");
      setSettings(data);
      setPrompt(data.prompt);
      setNotice("저장했어. 지우의 다음 음성 답변부터 적용돼.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "지우 설정을 저장하지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  return <details onToggle={event => { if (event.currentTarget.open && !settings && !error) void load(); }}>
    <summary>지우 캐릭터 설정</summary>
    {settings ? <form className={styles.toolFields} onSubmit={save}>
      <label>지우 대화 지침
        <textarea rows={12} required minLength={100} maxLength={30000} value={prompt} disabled={busy}
          onChange={event => { setPrompt(event.target.value); setNotice(""); }} />
      </label>
      <button disabled={busy || prompt === settings.prompt || prompt.trim().length < 100}>
        {busy ? "저장 중…" : "지우 설정 저장"}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </form> : <div className={styles.toolFields}>
      {busy && <p role="status">지우 설정을 불러오는 중…</p>}
      {error && <><p role="alert">{error}</p><button type="button" onClick={() => void load()}>다시 불러오기</button></>}
    </div>}
  </details>;
}

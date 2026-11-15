"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { JiwooProactivePreferences } from "@/lib/dokyeong/jiwoo-preferences";
import JiwooProactiveFields from "./JiwooProactiveFields";
import styles from "./live.module.css";

type SavedSettings = JiwooProactivePreferences & { version: number };
const endpoint = "/api/dokyeong/jiwoo-settings/proactive";

export default function JiwooProactiveEditor() {
  const [settings, setSettings] = useState<SavedSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "선톡 설정을 불러오지 못했어.");
      if (!controller.signal.aborted) {
        setSettings(data);
        setDirty(false);
        setConflict(false);
      }
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "다시 시도해 줘.");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy || !dirty || conflict) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (response.status === 409) setConflict(true);
      if (!response.ok) throw new Error(data.error || "선톡 설정을 저장하지 못했어.");
      setSettings(data);
      setDirty(false);
      setNotice("선톡 설정을 저장했어.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "다시 시도해 줘.");
    } finally {
      setBusy(false);
    }
  }

  function reload() {
    setBusy(true);
    setError("");
    setNotice("");
    setRevision(value => value + 1);
  }

  return <details>
    <summary>지우 선톡 설정</summary>
    <form className={styles.toolFields} onSubmit={save}>
      {settings ? <>
        <JiwooProactiveFields value={settings} disabled={busy || conflict} onChange={value => {
          setSettings({ ...value, version: settings.version });
          setDirty(true);
          setNotice("");
        }}/>
        <button type="submit" disabled={busy || !dirty || conflict}>{busy ? "저장 중…" : "선톡 설정 저장"}</button>
      </> : busy && <p role="status">선톡 설정을 불러오는 중…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {(!settings || conflict) && error && <button type="button" disabled={busy} onClick={reload}>다시 불러오기</button>}
    </form>
  </details>;
}

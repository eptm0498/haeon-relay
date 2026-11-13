"use client";

import { useState } from "react";
import { liveModelFields, liveModelKeys, type LiveModelOverrides, type LiveModelSettings } from "@/lib/dokyeong/model-catalog";
import styles from "./live.module.css";

export default function LiveModelEditor({ endpoint = "/api/dokyeong/model-settings" }: { endpoint?: string }) {
  const [settings, setSettings] = useState<LiveModelSettings | null>(null);
  const [draft, setDraft] = useState<LiveModelOverrides | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dirty = settings && draft && liveModelKeys.some(key => draft[key] !== settings.overrides[key]);

  async function request(method: "GET" | "PUT") {
    setBusy(true);
    setFeedback("");
    try {
      const response = await fetch(endpoint, {
        method,
        cache: "no-store",
        ...(method === "PUT" && { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ overrides: draft, version: settings?.version }) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setReload(true);
        throw Error(result.error || "모델 설정을 확인하지 못했어.");
      }
      setSettings(result);
      setDraft(result.overrides);
      setReload(false);
      if (method === "PUT") setFeedback("저장했어. 다음 대화부터 적용돼.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "잠시 뒤 다시 시도해 줘.");
    } finally {
      setBusy(false);
    }
  }

  return <details onToggle={event => {
    if (event.currentTarget.open && !settings && !busy) void request("GET");
  }}>
    <summary>앱 전체 대화 모델</summary>
    <div className={styles.toolFields} aria-busy={busy}>
      <p>웹과 홈 화면 앱의 모든 캐릭터에 적용돼. 모델에 따라 API 사용료가 달라질 수 있어.</p>
      {settings && draft ? <>
        {liveModelKeys.map(key => <label key={key}>
          {liveModelFields[key].label}
          <select value={draft[key] ?? ""} disabled={busy || reload} onChange={event => setDraft({ ...draft, [key]: event.target.value || null })}>
            <option value="">기본값 · {settings.defaults[key]}</option>
            {Object.entries(liveModelFields[key].models).map(([id, name]) =>
              <option key={id} value={id}>{name} ({id})</option>
            )}
          </select>
        </label>)}
        <p>실시간 목소리 연결이 끊기면 답변을 다 만든 뒤 재생할 수 있어.</p>
        <button type="button" disabled={!dirty || busy || reload} onClick={() => void request("PUT")}>모델 설정 저장</button>
      </> : busy ? <p>모델 설정을 불러오는 중…</p> : null}
      {(!settings || reload) && !busy && <button type="button" onClick={() => void request("GET")}>설정 다시 불러오기</button>}
      {feedback && <p role="status">{feedback}</p>}
    </div>
  </details>;
}

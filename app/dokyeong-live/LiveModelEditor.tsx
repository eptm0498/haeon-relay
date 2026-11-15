"use client";

import { useState } from "react";
import { geminiFreeModels, liveModelFields, liveModelKeys, type LiveModelOverrides, type LiveModelSettings } from "@/lib/dokyeong/model-catalog";
import styles from "./live.module.css";

function paidPrice({ input, output }: { input: number; output: number }) {
  return `$${input.toFixed(2)} / $${output.toFixed(2)}`;
}

function GeminiModelComparison() {
  return <details className={styles.modelComparison}>
    <summary>Gemini 모델별 비용·속도 비교</summary>
    <p>요금 단위는 USD / 100만 토큰이야. 출력 요금에는 추론 토큰이 포함돼.</p>
    <div className={styles.modelTableScroll} tabIndex={0} role="region" aria-label="Gemini 모델별 요금과 텍스트 속도">
      <table className={styles.modelTable} aria-label="Gemini 무료 등급 모델 비교">
        <thead>
          <tr><th scope="col">모델</th><th scope="col">무료 입력 / 출력</th><th scope="col">유료 표준 입력 / 출력</th><th scope="col">출력 속도</th><th scope="col">첫 답변 토큰</th></tr>
        </thead>
        <tbody>
          {Object.entries(geminiFreeModels).map(([id, { name, paid, benchmark }]) => <tr key={id}>
            <th scope="row">{name}{benchmark.thinking && <small>측정 설정 {benchmark.thinking}</small>}</th>
            <td>$0 / $0</td>
            <td>
              {paidPrice(paid)}{paid.offerUntil && <small>{paid.offerUntil}까지</small>}
              {paid.afterOffer && <small>이후 {paidPrice(paid.afterOffer)}</small>}
            </td>
            <td>약 {benchmark.tokensPerSecond}토큰/초</td>
            <td>약 {benchmark.firstTokenSeconds.toFixed(1)}초</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p>무료 요금은 연결된 프로젝트의 무료 한도 안에서 적용돼. 속도는 공개 텍스트 벤치마크이며 실제 통화에는 음성 인식·합성 시간도 들어가.</p>
    <p className={styles.modelSources}>
      <a href="https://aistudio.google.com/docs/pricing" target="_blank" rel="noreferrer">Google 공식 요금</a>
      <a href="https://artificialanalysis.ai/models" target="_blank" rel="noreferrer">공개 속도 벤치마크</a>
    </p>
  </details>;
}

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
      <p>웹과 홈 화면 앱의 모든 캐릭터에 적용돼. 문자·통화 답변은 무료 등급을 지원하는 Gemini 모델에서 골라.</p>
      {settings && draft ? <>
        {liveModelKeys.map(key => {
          const gemini = key === "textModel" || key === "voiceModel";
          const selected = gemini ? geminiFreeModels[draft[key] ?? settings.defaults[key]] : undefined;
          const defaultName = geminiFreeModels[settings.defaults[key]]?.name ?? settings.defaults[key];
          return <div key={key} className={styles.modelField}>
            <label>
              {liveModelFields[key].label}
              <select value={draft[key] ?? ""} disabled={busy || reload} onChange={event => setDraft({ ...draft, [key]: event.target.value || null })}>
                <option value="">기본값 · {defaultName}</option>
                {Object.entries(liveModelFields[key].models).map(([id, name]) =>
                  <option key={id} value={id}>{name}</option>
                )}
              </select>
            </label>
            {selected && <small>무료 입력 $0 · 출력 $0 · 약 {selected.benchmark.tokensPerSecond}토큰/초 · 첫 토큰 약 {selected.benchmark.firstTokenSeconds.toFixed(1)}초</small>}
          </div>;
        })}
        <GeminiModelComparison />
        <p>실시간 목소리 연결이 끊기면 답변을 다 만든 뒤 재생할 수 있어.</p>
        <button type="button" disabled={!dirty || busy || reload} onClick={() => void request("PUT")}>모델 설정 저장</button>
      </> : busy ? <p>모델 설정을 불러오는 중…</p> : null}
      {(!settings || reload) && !busy && <button type="button" onClick={() => void request("GET")}>설정 다시 불러오기</button>}
      {feedback && <p role="status">{feedback}</p>}
    </div>
  </details>;
}

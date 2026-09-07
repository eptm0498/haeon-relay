"use client";

import { useRef, useState } from "react";

type Result = {
  ok: boolean; useSecretary?: boolean; brief?: string; deliverable?: string; error?: string; warnings?: string[];
  decision?: { reason: string };
  meta?: { model?: string; calls: number; elapsedMs?: number; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
};

export default function BiseoPage() {
  const [task, setTask] = useState("");
  const [context, setContext] = useState("");
  const [mode, setMode] = useState<"auto" | "force">("auto");
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);

  async function run() {
    if (!task.trim() || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setLoading(true); setResult(null); setNotice("");
    const timer = setTimeout(() => active.abort("timeout"), 58000);
    try {
      const response = await fetch("/api/biseo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, context, mode, workStatus: exhausted ? "exhausted" : "available" }), signal: active.signal,
      });
      const data = await response.json().catch(() => null);
      if (!data || typeof data.ok !== "boolean") throw new Error(`서버 응답을 읽지 못했어 (HTTP ${response.status}). 입력은 남아 있으니 다시 시도해 줘.`);
      setResult(response.ok ? data : { ...data, ok: false, error: data.error || `요청 실패 (HTTP ${response.status})` });
    } catch (error) {
      setResult({ ok: false, error: active.signal.aborted ? (active.signal.reason === "timeout" ? "응답 시간이 초과됐어. 입력을 유지했으니 다시 시도할 수 있어." : "요청을 취소했어.") : error instanceof Error ? error.message : "연결에 실패했어. 다시 시도해 줘." });
    } finally {
      clearTimeout(timer); controller.current = null; setLoading(false);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("복사했어."); }
    catch { setNotice("자동 복사가 안 돼. 아래 결과를 선택해서 복사해 줘."); }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <p className="mb-2 text-sm text-neutral-400">Haeon Relay</p>
        <h1 className="text-3xl font-semibold">비서</h1>
        <p className="mt-3 mb-8 leading-7 text-neutral-400">분석부터 코드·문서 초안까지 비서가 먼저 작성하고, Work에는 실행과 검증에 필요한 내용만 넘겨.</p>
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <label htmlFor="task" className="mb-2 block text-sm font-medium">작업 내용</label>
          <textarea id="task" value={task} onChange={e => setTask(e.target.value)} maxLength={30000} disabled={loading} placeholder="완성할 결과와 지켜야 할 조건을 적어 줘." className="min-h-48 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-sm leading-6" />
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-neutral-300">참고 자료·코드 추가</summary>
            <p className="mt-2 text-xs leading-5 text-neutral-400">필요한 부분만 넣어 줘. 비밀번호·API 키·개인정보는 빼고, 링크 내용은 필요한 본문을 붙여 줘.</p>
            <textarea aria-label="참고 자료" value={context} onChange={e => setContext(e.target.value)} maxLength={60000} disabled={loading} className="mt-2 min-h-40 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-sm" />
          </details>
          <div className="mt-5 flex flex-wrap gap-2">
            {([['auto', '자동 절약'], ['force', '비서 강제 사용']] as const).map(([value, label]) => <button key={value} type="button" disabled={loading} aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-lg px-4 py-2 text-sm ${mode === value ? "bg-neutral-100 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>{label}</button>)}
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={exhausted} disabled={loading} onChange={e => setExhausted(e.target.checked)} />Work 사용량을 다 썼어</label>
          <p className="mt-2 text-xs leading-5 text-neutral-400">선택하면 비서가 여기서 쓸 수 있는 결과와 직접 실행할 방법까지 작성해. Work 잔여량은 자동 조회할 수 없어.</p>
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={run} disabled={loading || !task.trim()} className="rounded-xl bg-neutral-100 px-5 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-40">{loading ? "비서 작성 중…" : "비서에게 맡기기"}</button>
            {loading && <button type="button" onClick={() => controller.current?.abort()} className="rounded-xl border border-neutral-700 px-4 text-sm">취소</button>}
          </div>
          <p className="mt-3 text-xs leading-5 text-neutral-500">외부 모델의 무료 적용 여부는 해당 계정 설정에 따라 달라. 중계기는 결제·한도 설정을 변경하지 않아.</p>
        </section>
        <div aria-live="polite">
          {result && <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {!result.ok ? <p className="text-sm text-red-300">{result.error}</p> : <>
              <p className="text-sm text-neutral-400">{result.decision?.reason}</p>
              <div className="my-4 flex flex-wrap gap-2">
                {result.deliverable && <button onClick={() => copy(result.deliverable!)} className="rounded-lg bg-neutral-800 px-3 py-2 text-sm">결과 전체 복사</button>}
                {result.brief && <button onClick={() => copy(result.brief!)} className="rounded-lg bg-neutral-800 px-3 py-2 text-sm">실행 인계만 복사</button>}
              </div>
              <div className="whitespace-pre-wrap break-words rounded-xl bg-neutral-950 p-4 text-sm leading-7">{result.deliverable || result.brief}</div>
              {result.meta && <p className="mt-4 text-xs leading-6 text-neutral-500">{result.meta.model || "외부 호출 없음"} · 호출 {result.meta.calls}회{result.meta.usage?.total_tokens != null ? ` · 성공한 응답 ${result.meta.usage.total_tokens.toLocaleString()}토큰` : ""} · Work 절감량은 측정되지 않음</p>}
            </>}
            {result.warnings?.map((warning, index) => <p key={index} className="mt-3 text-sm text-amber-300">{warning}</p>)}
          </section>}
          {notice && <p className="mt-3 text-sm text-neutral-300">{notice}</p>}
        </div>
      </div>
    </main>
  );
}

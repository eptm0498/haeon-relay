"use client";

import { useState } from "react";

type Result = {
  ok: boolean;
  useSecretary?: boolean;
  mode?: "auto" | "force";
  decision?: { useSecretary: boolean; complexity: string; reason: string };
  brief?: string;
  error?: string;
};

export default function BiseoPage() {
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<"auto" | "force">("auto");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (!task.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/biseo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, mode }),
      });
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({ ok: false, error: "중계기 연결에 실패했습니다." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="mb-2 text-sm text-neutral-400">Haeon Relay</p>
          <h1 className="text-3xl font-semibold tracking-tight">비서</h1>
          <p className="mt-3 leading-7 text-neutral-400">
            Work가 쓰기 전에 Astra와 Claude가 외부에서 계획·비판·압축을 처리해
            Work의 불필요한 탐색을 줄인다.
          </p>
        </div>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <label htmlFor="task" className="mb-2 block text-sm font-medium">
            작업 내용
          </label>
          <textarea
            id="task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Work에 시킬 작업을 붙여넣어."
            className="min-h-64 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-sm leading-6 outline-none focus:border-neutral-500"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-xl border border-neutral-700 p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode("auto")}
                className={`rounded-lg px-4 py-2 ${mode === "auto" ? "bg-neutral-100 text-neutral-950" : "text-neutral-400"}`}
              >
                자동 절약
              </button>
              <button
                type="button"
                onClick={() => setMode("force")}
                className={`rounded-lg px-4 py-2 ${mode === "force" ? "bg-neutral-100 text-neutral-950" : "text-neutral-400"}`}
              >
                비서 강제 사용
              </button>
            </div>

            <button
              type="button"
              onClick={run}
              disabled={loading || !task.trim()}
              className="rounded-xl bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "비서 작업 중…" : "브리핑 만들기"}
            </button>
          </div>
        </section>

        {result && (
          <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {!result.ok ? (
              <p className="text-sm leading-6 text-red-300">{result.error}</p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-neutral-800 px-3 py-1.5">
                    {result.useSecretary ? "비서 사용" : "비서 생략"}
                  </span>
                  {result.decision?.complexity && (
                    <span className="rounded-full bg-neutral-800 px-3 py-1.5">
                      난이도 {result.decision.complexity}
                    </span>
                  )}
                </div>
                {result.decision?.reason && (
                  <p className="mb-4 text-sm leading-6 text-neutral-400">
                    판단: {result.decision.reason}
                  </p>
                )}
                <div className="whitespace-pre-wrap rounded-xl bg-neutral-950 p-4 text-sm leading-7">
                  {result.brief}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

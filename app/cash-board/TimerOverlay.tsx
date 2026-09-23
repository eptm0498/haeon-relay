"use client";

import { useEffect, useMemo, useState } from "react";

type TimerItem = {
  id: number;
  user_id: number;
  nickname: string;
  roulette_name: string;
  result_label: string;
  duration_minutes: number;
  started_at: string;
  ends_at: string;
};

type ActiveState = {
  id: number;
  label: string;
  nickname: string;
  started_at: string;
};

type QueueItem = {
  id: number;
  nickname: string;
  item_name: string;
  created_at: string;
};

function remainingMs(endsAt: string, now: number) {
  return Math.max(0, new Date(endsAt).getTime() - now);
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBroadcastClock(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatBroadcastRemaining(endsAt: string, now: number) {
  const totalSeconds = Math.max(
    0,
    Math.ceil((new Date(endsAt).getTime() - now) / 1000)
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

function formatElapsed(startedAt: string, now: number) {
  const totalSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TimerOverlay({ pin }: { pin: string }) {
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [gag, setGag] = useState<ActiveState | null>(null);
  const [smoking, setSmoking] = useState<ActiveState | null>(null);
  const [eating, setEating] = useState<ActiveState | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [broadcastEndAt, setBroadcastEndAt] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [clearingEffect, setClearingEffect] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function refreshTimers() {
    if (!pin) return;
    try {
      const response = await fetch("/api/cash-board-timers", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-pin": pin },
        body: JSON.stringify({ action: "list" }),
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) setTimers(Array.isArray(data.timers) ? data.timers : []);
    } catch {}
  }

  async function refreshStatus() {
    if (!pin) return;
    try {
      const response = await fetch("/api/cash-board", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-pin": pin },
        body: JSON.stringify({ action: "status_snapshot" }),
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) {
        setGag(data.gag ?? null);
        setSmoking(data.smoking ?? null);
        setEating(data.eating ?? null);
        setQueue(Array.isArray(data.queue) ? data.queue : []);
      }
    } catch {}
  }

  async function refreshBroadcast() {
    if (!pin) return;
    try {
      const response = await fetch("/api/cash-broadcast-state", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({ action: "get" }),
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) {
        setBroadcastEndAt(data.broadcast_end_at ?? null);
      }
    } catch {}
  }

  async function refreshAll() {
    await Promise.all([
      refreshStatus(),
      refreshTimers(),
      refreshBroadcast(),
    ]);
  }

  async function cancelQueue(item: QueueItem) {
    if (
      !window.confirm(
        `${item.nickname}님의 ${item.item_name} 대기를 취소하고 킵으로 돌려줄까?`
      )
    ) {
      return;
    }

    setCancellingId(item.id);

    try {
      const response = await fetch("/api/cash-board", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({
          action: "admin_cancel_queue",
          id: item.id,
        }),
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "대기 취소에 실패했어.");
      }

      await refreshAll();
      window.dispatchEvent(new Event("cash-queue-updated"));
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "대기 취소에 실패했어."
      );
    } finally {
      setCancellingId(null);
    }
  }

  async function clearEffect(
    effectType: "gag" | "smoking" | "eating",
    confirmMessage: string
  ) {
    if (clearingEffect) return;
    if (!window.confirm(confirmMessage)) return;

    setClearingEffect(effectType);

    try {
      const response = await fetch("/api/cash-board", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({
          action: "admin_clear_effect",
          effect_type: effectType,
        }),
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "상태 해제에 실패했어.");
      }

      await refreshAll();
      window.dispatchEvent(new Event("cash-effect-updated"));
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "상태 해제에 실패했어."
      );
    } finally {
      setClearingEffect(null);
    }
  }

  useEffect(() => {
    void refreshAll();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void refreshAll(), 2500);
    const onUpdated = () => void refreshAll();
    window.addEventListener("cash-timer-updated", onUpdated);
    window.addEventListener("cash-effect-updated", onUpdated);
    window.addEventListener("cash-queue-updated", onUpdated);
    window.addEventListener("cash-broadcast-updated", onUpdated);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
      window.removeEventListener("cash-timer-updated", onUpdated);
      window.removeEventListener("cash-effect-updated", onUpdated);
      window.removeEventListener("cash-queue-updated", onUpdated);
      window.removeEventListener("cash-broadcast-updated", onUpdated);
    };
  }, [pin]);

  const active = useMemo(
    () => timers.filter((timer) => remainingMs(timer.ends_at, now) > 0),
    [timers, now]
  );

  const hasRightPanel =
    active.length > 0 || Boolean(gag) || Boolean(smoking) || Boolean(eating) || queue.length > 0;

  if (!broadcastEndAt && !hasRightPanel) return null;

  return (
    <>
      {broadcastEndAt && (
        <div className="pointer-events-none fixed right-[calc(50%+328px)] top-5 z-[110] w-[132px] max-[820px]:hidden">
          <div className="rounded-2xl border border-sky-300/40 bg-zinc-950/95 px-3 py-2.5 text-white shadow-[0_12px_32px_rgba(20,18,40,.25)] backdrop-blur-xl">
            <div className="text-[8px] font-black tracking-[.08em] text-sky-200">
              오늘 방종시간
            </div>
            <div className="mt-1 text-[18px] font-black leading-none tracking-tight">
              {formatBroadcastClock(broadcastEndAt)}
            </div>
            <div className="mt-2 border-t border-white/10 pt-1.5">
              <div className="text-[8px] font-black text-white/40">남은 시간</div>
              <div className="mt-0.5 tabular-nums text-[11px] font-black text-sky-100">
                {formatBroadcastRemaining(broadcastEndAt, now)}
              </div>
            </div>
          </div>
        </div>
      )}

      {hasRightPanel && (
        <div className="pointer-events-none fixed left-[calc(50%+328px)] top-5 z-[110] flex w-[132px] flex-col gap-1.5 max-[820px]:hidden">
      {gag && (
        <div className="rounded-2xl border border-rose-300/50 bg-rose-600/95 px-3 py-2.5 text-white shadow-[0_12px_32px_rgba(190,24,93,.28)] backdrop-blur-xl">
          <div className="flex flex-col items-stretch gap-2">
            <div className="min-w-0">
              <div className="text-[9px] font-black tracking-[.08em] text-rose-100">말하기 금지</div>
              <div className="mt-0.5 text-[13px] font-black leading-none">현재 아봉중</div>
              <div className="mt-1 text-[9px] font-bold text-rose-100/85">{gag.nickname}님이 걸었음</div>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="tabular-nums text-[18px] font-black leading-none">
                {formatElapsed(gag.started_at, now)}
              </div>
              <button
                type="button"
                onClick={() =>
                  void clearEffect(
                    "gag",
                    "외부 후원 등으로 아봉을 해제할까?"
                  )
                }
                disabled={clearingEffect === "gag"}
                className="pointer-events-auto rounded-lg bg-white/15 px-2 py-1 text-[8px] font-black text-white ring-1 ring-white/20 disabled:opacity-40"
              >
                {clearingEffect === "gag" ? "해제중" : "해제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {smoking && (
        <div className="rounded-2xl border border-emerald-300/40 bg-emerald-950/95 px-3 py-2.5 text-white shadow-[0_12px_32px_rgba(5,150,105,.22)] backdrop-blur-xl">
          <div className="flex flex-col items-stretch gap-2">
            <div className="min-w-0">
              <div className="text-[9px] font-black tracking-[.08em] text-emerald-200">현재 상태</div>
              <div className="mt-0.5 text-[13px] font-black leading-none">금연중</div>
              <div className="mt-1 text-[9px] font-bold text-emerald-100/80">{smoking.nickname}님이 시작</div>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="tabular-nums text-[18px] font-black leading-none text-emerald-100">
                {formatElapsed(smoking.started_at, now)}
              </div>
              <button
                type="button"
                onClick={() =>
                  void clearEffect(
                    "smoking",
                    "금연 상태를 해제하고 흡연 가능 상태로 돌릴까?"
                  )
                }
                disabled={clearingEffect === "smoking"}
                className="pointer-events-auto rounded-lg bg-white/15 px-2 py-1 text-[8px] font-black text-white ring-1 ring-white/20 disabled:opacity-40"
              >
                {clearingEffect === "smoking" ? "해제중" : "해제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {eating && (
        <div
          className={
            "rounded-2xl border px-3 py-2.5 text-white shadow-[0_12px_32px_rgba(20,18,40,.24)] backdrop-blur-xl " +
            (eating.label === "먹어"
              ? "border-amber-300/50 bg-amber-600/95"
              : "border-sky-300/40 bg-sky-950/95")
          }
        >
          <div className="flex flex-col items-stretch gap-2">
            <div className="min-w-0">
              <div
                className={
                  "text-[9px] font-black tracking-[.08em] " +
                  (eating.label === "먹어"
                    ? "text-amber-100"
                    : "text-sky-200")
                }
              >
                먹어/먹지마
              </div>
              <div className="mt-0.5 text-[13px] font-black leading-none">
                현재 {eating.label} 상태
              </div>
              <div
                className={
                  "mt-1 text-[9px] font-bold " +
                  (eating.label === "먹어"
                    ? "text-amber-100/85"
                    : "text-sky-100/80")
                }
              >
                {eating.nickname}님 결과
              </div>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="tabular-nums text-[18px] font-black leading-none">
                {formatElapsed(eating.started_at, now)}
              </div>
              <button
                type="button"
                onClick={() =>
                  void clearEffect(
                    "eating",
                    "먹어/먹지마 상태를 해제할까?"
                  )
                }
                disabled={clearingEffect === "eating"}
                className="pointer-events-auto rounded-lg bg-white/15 px-2 py-1 text-[8px] font-black text-white ring-1 ring-white/20 disabled:opacity-40"
              >
                {clearingEffect === "eating" ? "해제중" : "해제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {active.slice(0, 4).map((timer) => {
        const left = remainingMs(timer.ends_at, now);
        const urgent = left <= 60_000;
        const isSpeech = timer.roulette_name === "말투";
        return (
          <div key={timer.id} className={"rounded-2xl border px-3 py-2 shadow-[0_12px_32px_rgba(20,18,40,.25)] backdrop-blur-xl " + (urgent ? "border-rose-300 bg-rose-600/95 text-white" : isSpeech ? "border-fuchsia-300/40 bg-fuchsia-950/94 text-white" : "border-white/20 bg-zinc-950/94 text-white")}>
            <div className="flex flex-col items-stretch gap-1.5">
              <div className="min-w-0 flex-1">
                <div className={"text-[9px] font-black tracking-[.08em] " + (urgent ? "text-rose-100" : "text-amber-200")}>{isSpeech ? "현재 말투" : "사용 중"}</div>
                <div className="mt-0.5 truncate text-[12px] font-black">{isSpeech ? timer.result_label : `${timer.nickname} · ${timer.result_label}`}</div>
              </div>
              <div className={"tabular-nums text-[20px] font-black leading-none tracking-tight " + (urgent ? "animate-pulse" : "")}>{formatRemaining(left)}</div>
            </div>
          </div>
        );
      })}

      {queue.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-violet-300/30 bg-zinc-950/95 text-white shadow-[0_12px_32px_rgba(20,18,40,.25)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="text-[10px] font-black text-violet-200">대기열</div>
            <div className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-black text-violet-100">{queue.length}</div>
          </div>
          <div className="divide-y divide-white/5 px-3">
            {queue.slice(0, 6).map((item, index) => (
              <div key={item.id} className="flex items-center gap-2 py-2">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-black text-zinc-300">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1 truncate text-[10px] font-black text-white">
                  {item.nickname} · {item.item_name}
                </div>
                <button
                  type="button"
                  onClick={() => void cancelQueue(item)}
                  disabled={cancellingId === item.id}
                  className="pointer-events-auto shrink-0 rounded-lg bg-rose-500/15 px-2 py-1 text-[9px] font-black text-rose-200 ring-1 ring-rose-300/20 disabled:opacity-40"
                >
                  {cancellingId === item.id ? "취소중" : "취소"}
                </button>
              </div>
            ))}
          </div>
          {queue.length > 6 && <div className="border-t border-white/10 px-3 py-1.5 text-right text-[9px] font-black text-zinc-400">+{queue.length - 6}개</div>}
        </div>
      )}
        </div>
      )}
    </>
  );
}

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

function remainingMs(endsAt: string, now: number) {
  return Math.max(0, new Date(endsAt).getTime() - now);
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TimerOverlay({ pin }: { pin: string }) {
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    if (!pin) return;
    try {
      const response = await fetch("/api/cash-board-timers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({ action: "list" }),
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) setTimers(Array.isArray(data.timers) ? data.timers : []);
    } catch {
      // 다음 주기에서 다시 불러온다.
    }
  }

  useEffect(() => {
    void refresh();

    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void refresh(), 3000);
    const onTimerUpdated = () => void refresh();
    window.addEventListener("cash-timer-updated", onTimerUpdated);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
      window.removeEventListener("cash-timer-updated", onTimerUpdated);
    };
  }, [pin]);

  const active = useMemo(
    () => timers.filter((timer) => remainingMs(timer.ends_at, now) > 0),
    [timers, now]
  );

  if (active.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[110] flex w-[min(300px,calc(100vw-20px))] flex-col gap-1.5">
      {active.slice(0, 4).map((timer) => {
        const left = remainingMs(timer.ends_at, now);
        const urgent = left <= 60_000;

        return (
          <div
            key={timer.id}
            className={
              "rounded-2xl border px-3 py-2 shadow-[0_12px_32px_rgba(20,18,40,.25)] backdrop-blur-xl " +
              (urgent
                ? "border-rose-300 bg-rose-600/95 text-white"
                : "border-white/20 bg-zinc-950/94 text-white")
            }
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className={"text-[9px] font-black tracking-[.08em] " + (urgent ? "text-rose-100" : "text-amber-200")}>
                  사용 중
                </div>
                <div className="mt-0.5 truncate text-[11px] font-black">
                  {timer.nickname} · {timer.result_label}
                </div>
              </div>

              <div
                className={
                  "shrink-0 tabular-nums text-[26px] font-black leading-none tracking-tight " +
                  (urgent ? "animate-pulse" : "")
                }
              >
                {formatRemaining(left)}
              </div>
            </div>
          </div>
        );
      })}

      {active.length > 4 && (
        <div className="self-end rounded-full bg-zinc-950/90 px-3 py-1 text-[10px] font-black text-white shadow-lg">
          +{active.length - 4}개 사용 중
        </div>
      )}
    </div>
  );
}

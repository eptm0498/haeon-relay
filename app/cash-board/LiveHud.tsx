"use client";

import { useEffect, useRef, useState } from "react";

type FeedItem = {
  id: number;
  nickname: string;
  roulette_name: string;
  spent: number;
  result: string;
  result_type: string;
  created_at: string;
};

type Snapshot = {
  global: {
    gauge_value: number;
    gauge_target: number;
    event_count: number;
    last_event_at: string | null;
  };
  stats: {
    spent_today: number;
    spins_today: number;
  };
  feed: FeedItem[];
};

const money = (value: number) => Number(value || 0).toLocaleString("ko-KR");

function time(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function LiveHud({ pin }: { pin: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [eventBurst, setEventBurst] = useState(false);
  const previousEvent = useRef<number | null>(null);

  async function refresh() {
    if (!pin) return;

    try {
      const response = await fetch("/api/cash-board", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-pin": pin,
        },
        body: JSON.stringify({ action: "live_snapshot" }),
        cache: "no-store",
      });

      const next = await response.json();
      if (!response.ok) return;

      const count = Number(next?.global?.event_count || 0);
      if (previousEvent.current !== null && count > previousEvent.current) {
        setEventBurst(true);
        window.setTimeout(() => setEventBurst(false), 3200);
      }
      previousEvent.current = count;
      setData(next as Snapshot);
    } catch {
      // 다음 폴링에서 다시 동기화한다.
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2200);
    return () => window.clearInterval(timer);
  }, [pin]);

  if (!data) return null;

  const target = Math.max(1, Number(data.global.gauge_target || 1));
  const value = Math.max(0, Number(data.global.gauge_value || 0));
  const percent = Math.min(100, (value / target) * 100);
  const feed = data.feed.slice(0, 3);

  return (
    <>
      {eventBurst && (
        <div className="pointer-events-none fixed left-1/2 top-4 z-[120] w-[min(520px,calc(100vw-24px))] -translate-x-1/2">
          <div className="animate-pulse rounded-[22px] border border-fuchsia-300 bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-500 px-4 py-3 text-center text-white shadow-[0_18px_55px_rgba(180,60,255,.45)]">
            <div className="text-[11px] font-black tracking-[.18em]">온유 게이지 최대치</div>
            <div className="mt-1 text-2xl font-black">방송 이벤트 발동 ✦</div>
          </div>
        </div>
      )}

      <section className="mb-4 overflow-hidden rounded-[24px] border border-zinc-200 bg-[#15131b] text-white shadow-[0_14px_42px_rgba(28,20,55,.14)]">
        <div className="p-3.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-black tracking-[.16em] text-fuchsia-300">온유 게이지</div>
              <div className="mt-0.5 text-xl font-black">
                {Math.floor(percent)}%
                <span className="ml-2 text-[11px] font-bold text-zinc-400">
                  {money(value)} / {money(target)} 캐시
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-zinc-500">오늘 방송</div>
              <div className="mt-0.5 text-[11px] font-black text-zinc-200">
                추첨 {money(data.stats.spins_today)}회 · {money(data.stats.spent_today)} 캐시
              </div>
            </div>
          </div>

          <div className="mt-2.5 h-3 overflow-hidden rounded-full bg-white/10 p-[2px]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 shadow-[0_0_16px_rgba(190,80,255,.65)] transition-[width] duration-700"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="mt-1.5 text-[9px] font-bold text-zinc-500">
            룰렛 사용 캐시가 함께 쌓여. 게이지는 당첨 확률에는 영향을 주지 않아.
          </div>
        </div>

        {feed.length > 0 && (
          <div className="border-t border-white/10 bg-white/[.035] px-3.5 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-black text-zinc-400">최근 추첨</span>
              <span className="text-[9px] font-bold text-zinc-600">실시간</span>
            </div>
            <div className="space-y-1.5">
              {feed.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-white/[.055] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11px] font-black text-white">{item.nickname}</span>
                      <span className="text-[9px] font-bold text-zinc-500">·</span>
                      <span className="truncate text-[11px] font-black text-fuchsia-200">{item.result}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[9px] font-bold text-zinc-500">
                      {item.roulette_name} · {money(item.spent)} 캐시 사용
                    </div>
                  </div>
                  <div className="shrink-0 text-[9px] font-black text-zinc-600">{time(item.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

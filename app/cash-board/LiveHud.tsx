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
    raid_round: number;
    raid_hp_max: number;
    raid_hp: number;
    raid_clear_count: number;
    raid_last_clear_at: string | null;
    raid_phase: number;
    chain_count: number;
    chain_peak: number;
    chain_active: boolean;
  };
  stats: {
    spent_today: number;
    spins_today: number;
  };
  feed: FeedItem[];
};

type Burst =
  | { key: string; eyebrow: string; title: string; tone: "violet" | "rose" | "cyan" }
  | null;

function burstClass(tone: "violet" | "rose" | "cyan") {
  if (tone === "rose") return "from-rose-500 via-fuchsia-600 to-violet-600 shadow-rose-400/35";
  if (tone === "cyan") return "from-cyan-400 via-blue-500 to-violet-600 shadow-cyan-400/35";
  return "from-fuchsia-600 via-violet-600 to-indigo-600 shadow-violet-400/35";
}

export default function LiveHud({ pin }: { pin: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [burst, setBurst] = useState<Burst>(null);

  const previousClear = useRef<number | null>(null);
  const previousPhase = useRef<number | null>(null);
  const previousRound = useRef<number | null>(null);
  const previousChain = useRef<number | null>(null);
  const burstTimer = useRef<number | null>(null);

  function showBurst(next: Exclude<Burst, null>) {
    setBurst(next);
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => setBurst(null), 2600);
  }

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

      const next = (await response.json()) as Snapshot;
      if (!response.ok || !next?.global) return;

      const clearCount = Number(next.global.raid_clear_count || 0);
      const round = Number(next.global.raid_round || 1);
      const phase = Number(next.global.raid_phase || 1);
      const chain = Number(next.global.chain_count || 0);

      if (previousClear.current !== null && clearCount > previousClear.current) {
        showBurst({
          key: "done-" + clearCount,
          eyebrow: "다 같이 채웠어요",
          title: "오늘 목표 완성 ✦",
          tone: "cyan",
        });
      } else if (
        previousRound.current === round &&
        previousPhase.current !== null &&
        phase > previousPhase.current
      ) {
        showBurst(
          phase >= 3
            ? {
                key: "almost-" + round,
                eyebrow: "거의 다 왔어요",
                title: "조금만 더 ✦",
                tone: "rose",
              }
            : {
                key: "half-" + round,
                eyebrow: "벌써 여기까지",
                title: "절반 넘었어요",
                tone: "violet",
              }
        );
      }

      const milestones = [3, 5, 8, 12, 20];
      const crossed = milestones.find(
        (value) =>
          previousChain.current !== null &&
          previousChain.current < value &&
          chain >= value
      );

      if (crossed) {
        showBurst({
          key: "together-" + crossed + "-" + Date.now(),
          eyebrow: "이어지고 있어요",
          title: crossed + "명째 참여 중",
          tone: "violet",
        });
      }

      previousClear.current = clearCount;
      previousRound.current = round;
      previousPhase.current = phase;
      previousChain.current = chain;
      setData(next);
    } catch {
      // 다음 동기화에서 복구한다.
    }
  }

  useEffect(() => {
    void refresh();

    const poll = window.setInterval(() => void refresh(), 1900);
    return () => {
      window.clearInterval(poll);
      if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    };
  }, [pin]);

  if (!data) return null;

  const maxHp = Math.max(1, Number(data.global.raid_hp_max || 1));
  const hp = Math.max(0, Number(data.global.raid_hp || 0));
  const remainingPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const donePercent = Math.max(0, Math.min(100, 100 - remainingPercent));
  const chain = Number(data.global.chain_count || 0);
  const barClass =
    donePercent >= 65
      ? "from-rose-400 via-fuchsia-500 to-violet-500 shadow-fuchsia-400/45"
      : donePercent >= 30
        ? "from-amber-300 via-fuchsia-500 to-violet-500 shadow-fuchsia-400/40"
        : "from-cyan-400 via-violet-500 to-fuchsia-500 shadow-violet-400/40";

  return (
    <>
      {burst && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-[140] w-[min(480px,calc(100vw-20px))] -translate-x-1/2">
          <div
            key={burst.key}
            className={
              "animate-pulse rounded-[22px] border border-white/40 bg-gradient-to-r px-4 py-3 text-center text-white shadow-[0_18px_60px_rgba(0,0,0,.28)] " +
              burstClass(burst.tone)
            }
          >
            <div className="text-[10px] font-black tracking-[.12em] text-white/75">{burst.eyebrow}</div>
            <div className="mt-0.5 text-[24px] font-black leading-tight">{burst.title}</div>
          </div>
        </div>
      )}

      <section className="mb-3 overflow-hidden rounded-[18px] border border-zinc-800/70 bg-[#121018] text-white shadow-[0_12px_34px_rgba(23,17,45,.18)]">
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-[12px] font-black">
                  오늘 목표
                  <span className="ml-2 text-[20px] font-black text-fuchsia-200">
                    {Math.floor(donePercent)}%
                  </span>
                </div>
                <div className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[9px] font-black text-zinc-400">
                  {data.global.raid_round}번째 목표
                </div>
              </div>

              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10 p-[1.5px]">
                <div
                  className={
                    "h-full rounded-full bg-gradient-to-r transition-[width] duration-700 shadow-[0_0_13px_currentColor] " +
                    barClass
                  }
                  style={{ width: donePercent + "%" }}
                />
              </div>
            </div>

            <div className="w-[104px] shrink-0 border-l border-white/10 pl-3 text-right">
              <div className="text-[10px] font-black text-zinc-500">
                이어가는 중
              </div>
              <div
                className={
                  "mt-0.5 text-[22px] font-black leading-none " +
                  (data.global.chain_active && chain >= 3 ? "text-fuchsia-200" : "text-white")
                }
              >
                {data.global.chain_active ? Math.max(1, chain) + "명째" : "다음 사람"}
              </div>
            </div>
          </div>
        </div>

      </section>
    </>
  );
}

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

const money = (value: number) => Number(value || 0).toLocaleString("ko-KR");

function time(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function burstClass(tone: "violet" | "rose" | "cyan") {
  if (tone === "rose") return "from-rose-500 via-fuchsia-600 to-violet-600 shadow-rose-400/35";
  if (tone === "cyan") return "from-cyan-400 via-blue-500 to-violet-600 shadow-cyan-400/35";
  return "from-fuchsia-600 via-violet-600 to-indigo-600 shadow-violet-400/35";
}

export default function LiveHud({ pin }: { pin: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [burst, setBurst] = useState<Burst>(null);
  const [feedIndex, setFeedIndex] = useState(0);

  const previousClear = useRef<number | null>(null);
  const previousPhase = useRef<number | null>(null);
  const previousRound = useRef<number | null>(null);
  const previousChain = useRef<number | null>(null);
  const burstTimer = useRef<number | null>(null);

  function showBurst(next: Exclude<Burst, null>) {
    setBurst(next);
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => setBurst(null), 2800);
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
          key: "clear-" + clearCount,
          eyebrow: "온유 레이드 클리어",
          title: "ROUND " + Math.max(1, round - 1) + " 격파 ✦",
          tone: "cyan",
        });
      } else if (
        previousRound.current === round &&
        previousPhase.current !== null &&
        phase > previousPhase.current
      ) {
        showBurst({
          key: "phase-" + round + "-" + phase,
          eyebrow: "보스 상태 변화",
          title: phase + "페이즈 돌입",
          tone: phase >= 3 ? "rose" : "violet",
        });
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
          key: "chain-" + crossed + "-" + Date.now(),
          eyebrow: "서로 다른 시청자가 이어붙였다",
          title: "참여 체인 ×" + crossed,
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
    const ticker = window.setInterval(() => {
      setFeedIndex((index) => index + 1);
    }, 2600);

    return () => {
      window.clearInterval(poll);
      window.clearInterval(ticker);
      if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    };
  }, [pin]);

  if (!data) return null;

  const maxHp = Math.max(1, Number(data.global.raid_hp_max || 1));
  const hp = Math.max(0, Number(data.global.raid_hp || 0));
  const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const phase = Number(data.global.raid_phase || 1);
  const chain = Number(data.global.chain_count || 0);
  const latest = data.feed.length ? data.feed[feedIndex % Math.min(3, data.feed.length)] : null;

  const barClass =
    phase >= 3
      ? "from-rose-500 via-fuchsia-500 to-orange-400 shadow-rose-400/50"
      : phase === 2
        ? "from-amber-400 via-fuchsia-500 to-violet-500 shadow-fuchsia-400/45"
        : "from-cyan-400 via-violet-500 to-fuchsia-500 shadow-violet-400/45";

  return (
    <>
      {burst && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-[140] w-[min(500px,calc(100vw-20px))] -translate-x-1/2">
          <div
            key={burst.key}
            className={
              "animate-pulse rounded-[22px] border border-white/40 bg-gradient-to-r px-4 py-3 text-center text-white shadow-[0_18px_60px_rgba(0,0,0,.28)] " +
              burstClass(burst.tone)
            }
          >
            <div className="text-[10px] font-black tracking-[.16em] text-white/75">{burst.eyebrow}</div>
            <div className="mt-0.5 text-[24px] font-black leading-tight">{burst.title}</div>
          </div>
        </div>
      )}

      <section className="mb-3 overflow-hidden rounded-[20px] border border-zinc-800/70 bg-[#121018] text-white shadow-[0_12px_34px_rgba(23,17,45,.18)]">
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[9px] font-black text-zinc-300">
                  ROUND {data.global.raid_round}
                </span>
                <div className="min-w-0 truncate text-[12px] font-black">
                  온유 레이드
                  <span className="ml-1.5 text-[10px] font-bold text-zinc-500">{phase}페이즈</span>
                </div>
              </div>

              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10 p-[1.5px]">
                <div
                  className={
                    "h-full rounded-full bg-gradient-to-r transition-[width] duration-700 shadow-[0_0_13px_currentColor] " +
                    barClass
                  }
                  style={{ width: hpPercent + "%" }}
                />
              </div>

              <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-bold text-zinc-500">
                <span>보스 HP {money(hp)} / {money(maxHp)}</span>
                <span>{Math.ceil(hpPercent)}%</span>
              </div>
            </div>

            <div className="w-[92px] shrink-0 border-l border-white/10 pl-3 text-right">
              <div
                className={
                  "text-[10px] font-black " +
                  (data.global.chain_active && chain >= 3 ? "text-fuchsia-300" : "text-zinc-500")
                }
              >
                참여 체인
              </div>
              <div className="mt-0.5 text-[24px] font-black leading-none">
                {data.global.chain_active ? "×" + Math.max(1, chain) : "대기"}
              </div>
              <div className="mt-1 text-[8px] font-bold text-zinc-600">다른 닉네임이 3분 안에 연결</div>
            </div>
          </div>
        </div>

        <div className="flex h-[34px] items-center border-t border-white/10 bg-white/[.035] px-3">
          {latest ? (
            <>
              <div className="min-w-0 flex-1 truncate text-[10px] font-bold text-zinc-400">
                <span className="font-black text-white">{latest.nickname}</span>
                <span className="mx-1 text-zinc-600">›</span>
                <span className="font-black text-fuchsia-200">{latest.result}</span>
                <span className="mx-1 text-zinc-600">·</span>
                {latest.roulette_name}
              </div>
              <div className="ml-2 shrink-0 text-[9px] font-black text-zinc-600">{time(latest.created_at)}</div>
            </>
          ) : (
            <div className="text-[10px] font-bold text-zinc-600">첫 추첨을 기다리는 중</div>
          )}
        </div>
      </section>
    </>
  );
}

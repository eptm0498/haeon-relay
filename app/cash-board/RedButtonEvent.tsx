"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type User = {
  id: number;
  nickname: string;
  cash_balance: number;
};

type Props = {
  pin: string;
  users: User[];
  onChanged: () => Promise<unknown>;
  onNotice: (message: string) => void;
};

type Phase = "idle" | "offer" | "pressing" | "result";

const STORAGE_KEY = "cash-red-button-next-at-v1";
const OUTCOMES = [
  "방송 단축 30분",
  "방송 연장 30분",
  "즉시 흡연",
  "즉시 금연",
  "원하는 시청자에게 5000 캐시 지급",
  "팔굽혀펴기 10회",
  "스쿼트 10회",
] as const;

const REWARD_OUTCOME = "원하는 시청자에게 5000 캐시 지급";

function nextDelayMs() {
  // 20~40분 사이 무작위 출현. 평균 30분이라 방송 1시간당 약 2회.
  return (20 + Math.random() * 20) * 60 * 1000;
}

async function post<T>(
  pin: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/cash-board", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-pin": pin,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "빨간 버튼 결과를 처리하지 못했어.");
  }
  return data as T;
}

export default function RedButtonEvent({
  pin,
  users,
  onChanged,
  onNotice,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState("");
  const [rewardNick, setRewardNick] = useState("");
  const [rewarding, setRewarding] = useState(false);
  const [rewardDone, setRewardDone] = useState(false);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const matchingUsers = useMemo(() => {
    const query = rewardNick.trim().toLowerCase();
    if (!query) return users.slice(0, 8);
    return users
      .filter((user) => user.nickname.toLowerCase().includes(query))
      .slice(0, 8);
  }, [rewardNick, users]);

  function scheduleNext() {
    const nextAt = Date.now() + nextDelayMs();
    window.localStorage.setItem(STORAGE_KEY, String(nextAt));

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      setOutcome("");
      setRewardNick("");
      setRewardDone(false);
      setPhase("offer");
    }, Math.max(1000, nextAt - Date.now()));
  }

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY) || 0);
    const now = Date.now();

    if (!Number.isFinite(stored) || stored <= 0) {
      scheduleNext();
    } else if (stored <= now) {
      setPhase("offer");
    } else {
      timerRef.current = window.setTimeout(() => {
        setPhase("offer");
      }, stored - now);
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      try {
        void audioRef.current?.close();
      } catch {}
    };
  }, []);

  function playImpact() {
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();

      const now = context.currentTime;
      [95, 145, 220, 330, 510].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = index < 2 ? "sawtooth" : "sine";
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.055);
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 1.8,
          now + 0.25 + index * 0.055
        );
        gain.gain.setValueAtTime(0.0001, now + index * 0.055);
        gain.gain.exponentialRampToValueAtTime(
          index === 0 ? 0.12 : 0.045,
          now + 0.02 + index * 0.055
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.34 + index * 0.055
        );
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + index * 0.055);
        oscillator.stop(now + 0.4 + index * 0.055);
      });
    } catch {}
  }

  function giveUp() {
    scheduleNext();
    setPhase("idle");
    setOutcome("");
  }

  function pressButton() {
    if (phase !== "offer") return;
    scheduleNext();
    setPhase("pressing");
    playImpact();

    window.setTimeout(() => {
      const result = OUTCOMES[Math.floor(Math.random() * OUTCOMES.length)];
      setOutcome(result);
      setRewardDone(false);
      setPhase("result");
    }, 1550);
  }

  async function grantReward() {
    const target = users.find(
      (user) => user.nickname === rewardNick.trim()
    );
    if (!target) {
      onNotice("5,000 캐시를 받을 시청자를 목록에서 선택해줘.");
      return;
    }

    setRewarding(true);
    try {
      await post<{ ok: boolean; balance: number; amount: number }>(pin, {
        action: "red_button_reward",
        nickname: target.nickname,
      });
      await onChanged();
      setRewardDone(true);
      onNotice(`${target.nickname}에게 빨간 버튼 보상 5,000 캐시 지급 완료`);
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "5,000 캐시 지급에 실패했어."
      );
    } finally {
      setRewarding(false);
    }
  }

  if (phase === "idle") return null;

  const resultIsReward = outcome === REWARD_OUTCOME;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-black/80 px-4 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[76vmin] w-[76vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border-[10px] border-red-500/20 animate-ping" />
        <div className="absolute left-1/2 top-1/2 h-[58vmin] w-[58vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border-[4px] border-orange-300/25 animate-pulse" />
        <div className="absolute left-1/2 top-1/2 h-[42vmin] w-[42vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/20 animate-spin" />
        {Array.from({ length: 28 }).map((_, index) => (
          <span
            key={index}
            className={
              "absolute h-2 w-2 rounded-full " +
              (phase === "pressing" ? "animate-ping bg-yellow-200" : "bg-red-400/60")
            }
            style={{
              left: `${4 + ((index * 37) % 92)}%`,
              top: `${5 + ((index * 53) % 88)}%`,
              animationDelay: `${(index % 8) * 70}ms`,
              transform: `scale(${0.7 + (index % 5) * 0.22})`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-[520px] text-center text-white">
        {phase === "offer" && (
          <>
            <div className="mb-3 text-xs font-black tracking-[.34em] text-red-200">
              SUDDEN EVENT
            </div>
            <div className="mb-6 text-3xl font-black tracking-tight">
              빨간 버튼이 나타났다
            </div>

            <button
              type="button"
              onClick={pressButton}
              className="group relative mx-auto block h-56 w-56 rounded-full border-[12px] border-red-950 bg-[radial-gradient(circle_at_38%_28%,#ff8b8b_0%,#ff1919_25%,#bd0000_58%,#650000_100%)] shadow-[0_14px_0_#3f0000,0_28px_55px_rgba(255,0,0,.55),inset_0_10px_20px_rgba(255,255,255,.32)] transition active:translate-y-3 active:shadow-[0_2px_0_#3f0000,0_15px_35px_rgba(255,0,0,.7)]"
              aria-label="빨간 버튼 누르기"
            >
              <span className="absolute inset-4 rounded-full border border-white/25" />
              <span className="relative text-3xl font-black drop-shadow-lg">
                누르기
              </span>
            </button>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={pressButton}
                className="rounded-2xl bg-red-600 px-4 py-4 text-lg font-black shadow-[0_10px_35px_rgba(239,68,68,.35)]"
              >
                누르기
              </button>
              <button
                type="button"
                onClick={giveUp}
                className="rounded-2xl bg-white/10 px-4 py-4 text-lg font-black text-white/80 ring-1 ring-white/20 backdrop-blur"
              >
                포기하기
              </button>
            </div>
          </>
        )}

        {phase === "pressing" && (
          <div className="relative mx-auto flex min-h-[430px] flex-col items-center justify-center">
            <div className="absolute h-80 w-80 rounded-full bg-red-500/25 blur-3xl animate-pulse" />
            <div className="relative flex h-60 w-60 scale-90 items-center justify-center rounded-full border-[14px] border-yellow-200/40 bg-[radial-gradient(circle,#fff6b7_0%,#ff3b1f_25%,#a90000_62%,#280000_100%)] shadow-[0_0_85px_rgba(255,68,0,.9)] animate-pulse">
              <div className="text-4xl font-black tracking-tight">결과 추첨</div>
            </div>
            <div className="relative mt-8 text-sm font-black tracking-[.28em] text-yellow-100 animate-pulse">
              RANDOMIZING
            </div>
          </div>
        )}

        {phase === "result" && (
          <div className="relative overflow-hidden rounded-[34px] border border-red-300/30 bg-[linear-gradient(145deg,rgba(90,0,0,.96),rgba(20,20,24,.98))] p-6 shadow-[0_0_100px_rgba(255,30,0,.45)]">
            <div className="absolute -left-20 -top-20 h-52 w-52 rounded-full bg-red-500/30 blur-3xl" />
            <div className="absolute -bottom-20 -right-20 h-52 w-52 rounded-full bg-yellow-400/20 blur-3xl" />

            <div className="relative text-[11px] font-black tracking-[.3em] text-red-200">
              RED BUTTON RESULT
            </div>
            <div className="relative mt-5 text-3xl font-black leading-tight text-white sm:text-4xl">
              {outcome}
            </div>

            {resultIsReward && !rewardDone && (
              <div className="relative mt-6 rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
                <div className="text-left text-xs font-black text-white/65">
                  5,000 캐시를 받을 시청자
                </div>
                <input
                  value={rewardNick}
                  onChange={(event) => setRewardNick(event.target.value)}
                  placeholder="닉네임 검색"
                  className="mt-2 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-black text-white outline-none placeholder:text-white/35 focus:border-red-300/60"
                />
                {matchingUsers.length > 0 && (
                  <div className="mt-2 max-h-36 overflow-auto rounded-xl bg-black/30 p-1.5">
                    {matchingUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setRewardNick(user.nickname)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-black hover:bg-white/10"
                      >
                        <span>{user.nickname}</span>
                        <span className="text-white/45">
                          {Number(user.cash_balance || 0).toLocaleString("ko-KR")} 캐시
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={grantReward}
                  disabled={rewarding || !rewardNick.trim()}
                  className="mt-3 w-full rounded-xl bg-yellow-300 px-4 py-3 text-sm font-black text-zinc-950 disabled:opacity-40"
                >
                  {rewarding ? "지급 중..." : "5,000 캐시 지급"}
                </button>
              </div>
            )}

            {rewardDone && (
              <div className="relative mt-5 rounded-2xl bg-emerald-400/15 px-4 py-3 text-sm font-black text-emerald-100 ring-1 ring-emerald-300/20">
                {rewardNick}에게 5,000 캐시 지급 완료
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setOutcome("");
              }}
              className="relative mt-6 w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-black text-zinc-950"
            >
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

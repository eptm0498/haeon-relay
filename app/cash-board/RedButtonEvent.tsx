"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import fx from "./redButton.module.css";

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
const RATE_KEY = "cash-red-button-rate-v1";
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

function nextDelayMs(perHour: number) {
  if (!Number.isFinite(perHour) || perHour <= 0) return 0;
  return (60 * 60 * 1000) / perHour;
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

async function postBroadcast<T>(
  pin: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/cash-broadcast-state", {
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
    throw new Error(data?.error || "방송 상태를 반영하지 못했어.");
  }
  return data as T;
}

async function postEvent<T>(
  pin: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/cash-event-settings", {
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
    throw new Error(data?.error || "이벤트 설정을 불러오지 못했어.");
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
  const rateRef = useRef(0);
  const rouletteBusyRef = useRef(false);
  const rouletteBlockedUntilRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);

  const matchingUsers = useMemo(() => {
    const query = rewardNick.trim().toLowerCase();
    if (!query) return users.slice(0, 8);
    return users
      .filter((user) => user.nickname.toLowerCase().includes(query))
      .slice(0, 8);
  }, [rewardNick, users]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function openOffer() {
    const now = Date.now();
    if (rouletteBusyRef.current || now < rouletteBlockedUntilRef.current) {
      armTimer(
        rouletteBusyRef.current
          ? now + 1000
          : rouletteBlockedUntilRef.current
      );
      return;
    }
    setOutcome("");
    setRewardNick("");
    setRewardDone(false);
    setPhase("offer");
  }

  function armTimer(nextAt: number) {
    clearTimer();
    timerRef.current = window.setTimeout(
      openOffer,
      Math.max(1000, nextAt - Date.now())
    );
  }

  function applyRate(perHour: number, resetSchedule: boolean) {
    const rate = Math.max(0, Math.min(60, Math.round(Number(perHour || 0))));
    rateRef.current = rate;
    clearTimer();

    if (rate <= 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.setItem(RATE_KEY, "0");
      setPhase((current) => (current === "offer" ? "idle" : current));
      return;
    }

    const storedRate = Number(window.localStorage.getItem(RATE_KEY) || -1);
    const storedNextAt = Number(window.localStorage.getItem(STORAGE_KEY) || 0);
    const sameRate = storedRate === rate;
    const validStored =
      Number.isFinite(storedNextAt) && storedNextAt > Date.now();

    if (!resetSchedule && sameRate && validStored) {
      armTimer(storedNextAt);
      return;
    }

    if (!resetSchedule && sameRate && storedNextAt > 0 && storedNextAt <= Date.now()) {
      openOffer();
      return;
    }

    const nextAt = Date.now() + nextDelayMs(rate);
    window.localStorage.setItem(RATE_KEY, String(rate));
    window.localStorage.setItem(STORAGE_KEY, String(nextAt));
    armTimer(nextAt);
  }

  function scheduleNext() {
    const rate = rateRef.current;
    if (rate <= 0) {
      clearTimer();
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const nextAt = Date.now() + nextDelayMs(rate);
    window.localStorage.setItem(RATE_KEY, String(rate));
    window.localStorage.setItem(STORAGE_KEY, String(nextAt));
    armTimer(nextAt);
  }

  useEffect(() => {
    let active = true;

    const loadRate = async (resetSchedule = false) => {
      try {
        const settings = await postEvent<{
          ok: boolean;
          red_button_per_hour: number;
        }>(pin, { action: "load" });
        if (!active) return;
        applyRate(
          Number(settings.red_button_per_hour ?? 0),
          resetSchedule
        );
      } catch {}
    };

    void loadRate(false);

    const handleSettingsChanged = () => {
      void loadRate(true);
    };

    window.addEventListener(
      "cash-event-settings-updated",
      handleSettingsChanged
    );

    const handleRouletteActivity = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const activeRoulette = Boolean(detail.active);
      rouletteBusyRef.current = activeRoulette;

      if (activeRoulette) {
        clearTimer();
        setPhase((current) => (current === "offer" ? "idle" : current));
        return;
      }

      rouletteBlockedUntilRef.current = Math.max(
        rouletteBlockedUntilRef.current,
        Number(detail.blockedUntil || Date.now() + 10000)
      );

      const stored = Number(
        window.localStorage.getItem(STORAGE_KEY) || 0
      );
      const target = Math.max(
        rouletteBlockedUntilRef.current,
        Number.isFinite(stored) ? stored : 0
      );
      armTimer(target > Date.now() ? target : Date.now() + 1000);
    };

    window.addEventListener(
      "cash-roulette-activity",
      handleRouletteActivity
    );

    return () => {
      active = false;
      window.removeEventListener(
        "cash-event-settings-updated",
        handleSettingsChanged
      );
      window.removeEventListener(
        "cash-roulette-activity",
        handleRouletteActivity
      );
      clearTimer();
      try {
        void audioRef.current?.close();
      } catch {}
    };
  }, [pin]);

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

  function playResultReveal() {
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();

      const now = context.currentTime;

      const master = context.createGain();
      master.gain.setValueAtTime(0.8, now);
      master.connect(context.destination);

      const boom = context.createOscillator();
      const boomGain = context.createGain();
      boom.type = "sine";
      boom.frequency.setValueAtTime(92, now);
      boom.frequency.exponentialRampToValueAtTime(38, now + 0.65);
      boomGain.gain.setValueAtTime(0.0001, now);
      boomGain.gain.exponentialRampToValueAtTime(0.34, now + 0.018);
      boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.78);
      boom.connect(boomGain);
      boomGain.connect(master);
      boom.start(now);
      boom.stop(now + 0.82);

      const impact = context.createOscillator();
      const impactGain = context.createGain();
      impact.type = "sawtooth";
      impact.frequency.setValueAtTime(260, now + 0.02);
      impact.frequency.exponentialRampToValueAtTime(82, now + 0.34);
      impactGain.gain.setValueAtTime(0.0001, now);
      impactGain.gain.exponentialRampToValueAtTime(0.1, now + 0.025);
      impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      impact.connect(impactGain);
      impactGain.connect(master);
      impact.start(now + 0.02);
      impact.stop(now + 0.42);

      [392, 523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = index % 2 === 0 ? "triangle" : "sine";
        osc.frequency.setValueAtTime(frequency, now + 0.08 + index * 0.06);
        gain.gain.setValueAtTime(0.0001, now + index * 0.06);
        gain.gain.exponentialRampToValueAtTime(
          0.055 - index * 0.006,
          now + 0.1 + index * 0.06
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.72 + index * 0.07
        );
        osc.connect(gain);
        gain.connect(master);
        osc.start(now + 0.07 + index * 0.06);
        osc.stop(now + 0.82 + index * 0.07);
      });

      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * 0.42),
        context.sampleRate
      );
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i += 1) {
        const fade = 1 - i / channel.length;
        channel[i] = (Math.random() * 2 - 1) * fade * fade;
      }
      const noise = context.createBufferSource();
      const noiseGain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1500, now);
      filter.Q.setValueAtTime(0.7, now);
      noise.buffer = buffer;
      noiseGain.gain.setValueAtTime(0.12, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
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
      playResultReveal();

      void (async () => {
        try {
          const applied = await postBroadcast<{
            ok: boolean;
            adjusted_minutes?: number;
            smoking_changed?: boolean;
          }>(pin, {
            action: "apply_outcome",
            outcome: result,
            source: "빨간 버튼",
          });

          if (Number(applied.adjusted_minutes || 0) !== 0) {
            window.dispatchEvent(new Event("cash-broadcast-updated"));
          }
          if (applied.smoking_changed) {
            window.dispatchEvent(new Event("cash-effect-updated"));
            window.dispatchEvent(new Event("cash-timer-updated"));
          }
        } catch (error) {
          onNotice(
            error instanceof Error
              ? error.message
              : "빨간 버튼 결과 자동 반영에 실패했어."
          );
        }
      })();
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

  const eventStage =
    typeof document !== "undefined"
      ? document.getElementById("cash-game-stage")
      : null;

  if (phase === "idle" || !eventStage) return null;

  const resultIsReward = outcome === REWARD_OUTCOME;

  return createPortal(
    <div className={fx.screen + (phase === "result" ? " " + fx.resultScreen : "")}>
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
              깜짝 이벤트
            </div>
            <div className="mb-6 text-3xl font-black tracking-tight">
              빨간 버튼이 나타났다
            </div>

            <button
              type="button"
              onClick={pressButton}
              className={fx.offerButton + " group relative mx-auto block h-56 w-56 rounded-full border-[12px] border-red-950 bg-[radial-gradient(circle_at_38%_28%,#ff8b8b_0%,#ff1919_25%,#bd0000_58%,#650000_100%)] shadow-[0_14px_0_#3f0000,0_28px_55px_rgba(255,0,0,.55),inset_0_10px_20px_rgba(255,255,255,.32)] active:translate-y-3 active:shadow-[0_2px_0_#3f0000,0_15px_35px_rgba(255,0,0,.7)]"}
              aria-label="빨간 버튼 누르기"
            >
              <span className={fx.offerPulseRing} />
              <span className={fx.offerSheen} />
              <span className="absolute inset-4 rounded-full border border-white/25" />
              <span className="relative text-3xl font-black drop-shadow-lg">
                누르기
              </span>
            </button>

            <button
              type="button"
              onClick={giveUp}
              className="mt-7 w-full rounded-2xl bg-white/10 px-4 py-3.5 text-base font-black text-white/80 ring-1 ring-white/20 backdrop-blur"
            >
              포기하기
            </button>
          </>
        )}

        {phase === "pressing" && (
          <div className="relative mx-auto flex min-h-[430px] flex-col items-center justify-center">
            <div className="absolute h-80 w-80 rounded-full bg-red-500/25 blur-3xl animate-pulse" />
            <div className="relative flex h-60 w-60 scale-90 items-center justify-center rounded-full border-[14px] border-yellow-200/40 bg-[radial-gradient(circle,#fff6b7_0%,#ff3b1f_25%,#a90000_62%,#280000_100%)] shadow-[0_0_85px_rgba(255,68,0,.9)] animate-pulse">
              <div className="text-4xl font-black tracking-tight">결과 추첨</div>
            </div>
            <div className="relative mt-8 text-sm font-black tracking-[.28em] text-yellow-100 animate-pulse">
              미션 추첨 중
            </div>
          </div>
        )}

        {phase === "result" && (
          <>
            <div className={fx.resultBackdrop} />
            <div className={fx.resultAura} />
            <div className={fx.centerBurst} />
            <div className={fx.flashWhite} />
            <div className={fx.flashRed} />
            <div className={fx.flashGold} />
            <div className={fx.shockwave} />
            <div className={fx.shockwave + " " + fx.shockwave2} />
            <div className={fx.shockwave + " " + fx.shockwave3} />

            {Array.from({ length: 72 }).map((_, index) => {
              const angle = (index / 72) * Math.PI * 2;
              const distance = 180 + (index % 9) * 34;
              const palette = [
                "#fff8cf",
                "#ffd43b",
                "#ff7a00",
                "#ff2b00",
                "#ff4d91",
                "#7df9ff",
              ];
              return (
                <span
                  key={"burst-" + index}
                  className={fx.particle}
                  style={
                    {
                      "--dx": `${Math.cos(angle) * distance}px`,
                      "--dy": `${Math.sin(angle) * distance}px`,
                      "--size": `${5 + (index % 7) * 1.5}px`,
                      "--delay": `${(index % 12) * 22}ms`,
                      "--rot": `${240 + index * 19}deg`,
                      color: palette[index % palette.length],
                    } as React.CSSProperties
                  }
                />
              );
            })}

            {Array.from({ length: 24 }).map((_, index) => (
              <span
                key={"meteor-" + index}
                className={fx.spark}
                style={
                  {
                    "--x": `${4 + ((index * 37) % 92)}%`,
                    "--y": `${-6 + ((index * 29) % 58)}%`,
                    "--delay": `${180 + (index % 8) * 55}ms`,
                  } as React.CSSProperties
                }
              />
            ))}

            {Array.from({ length: 14 }).map((_, index) => (
              <span
                key={"star-" + index}
                className={fx.star}
                style={
                  {
                    left: `${8 + ((index * 41) % 84)}%`,
                    top: `${10 + ((index * 31) % 72)}%`,
                    fontSize: `${18 + (index % 5) * 7}px`,
                    "--delay": `${420 + (index % 7) * 110}ms`,
                  } as React.CSSProperties
                }
              >
                ✦
              </span>
            ))}

            <div className={fx.vignette} />

            <div className={fx.resultWrap}>
              <div className={fx.resultBanner}>깜짝 미션</div>
              <div className={fx.resultCard}>
                <div className={fx.cardGlowA} />
                <div className={fx.cardGlowB} />

                <div className={fx.resultLabel}>온유의 미션</div>
                <div className="relative z-10 mt-2 text-sm font-black text-white/75">
                  온유가 버튼을 눌렀으니, 이 미션은 온유가 해야 해.
                </div>
                <div className={fx.resultTextShell}>
                  <div className={fx.resultTextRed} aria-hidden="true">
                    {outcome}
                  </div>
                  <div className={fx.resultTextCyan} aria-hidden="true">
                    {outcome}
                  </div>
                  <div className={fx.resultText}>{outcome}</div>
                </div>

                {(outcome.startsWith("방송 연장") ||
                  outcome.startsWith("방송 단축")) && (
                  <div className="relative z-10 mt-3 rounded-full bg-sky-400/15 px-3 py-1.5 text-[11px] font-black text-sky-100 ring-1 ring-sky-300/20">
                    오늘 방종시간에 자동 반영
                  </div>
                )}
                {(outcome === "즉시 금연" || outcome === "즉시 흡연") && (
                  <div className="relative z-10 mt-3 rounded-full bg-emerald-400/15 px-3 py-1.5 text-[11px] font-black text-emerald-100 ring-1 ring-emerald-300/20">
                    우측 상태 타이머에 자동 반영
                  </div>
                )}

                <div className={fx.contentFadeIn}>

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
                    className="relative mt-6 w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-black text-zinc-950 shadow-[0_0_35px_rgba(255,255,255,.18)] transition hover:scale-[1.01] active:scale-[.98]"
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    eventStage
  );
}

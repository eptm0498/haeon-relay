"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import fx from "./effects.module.css";

type User = {
  id: number;
  nickname: string;
  cash_balance: number;
  title_text?: string | null;
};

type Roulette = { id: number; name: string; cost: number };

type RouletteItem = {
  id: number;
  label: string;
  result_type: "keep" | "cash" | "cash_loss" | "nothing";
  cash_amount: number;
  weight: number;
  time_limit_minutes?: number;
  sort_order: number;
};

type RouletteConfig = Roulette & {
  active: boolean;
  items: RouletteItem[];
};

type SpinResult = {
  ok: boolean;
  spin_id: number;
  label: string;
  result_type: "keep" | "cash" | "cash_loss" | "nothing";
  balance: number;
  cash_delta?: number;
  cost?: number;
  handled?: boolean;
  handled_mode?: "use" | "keep";
};

type SpinResponse = {
  ok: boolean;
  results: SpinResult[];
  count: number;
  effective_cost: number;
  discount_percent: number;
  total_cost: number;
  balance: number;
};

const colors = [
  "#ff4fa3",
  "#7b5cff",
  "#24c8ff",
  "#ffcc33",
  "#ff715b",
  "#46d99a",
  "#ff8bd5",
  "#4a8cff",
];

const money = (v: number) => Number(v || 0).toLocaleString("ko-KR");
const delay = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function post<T>(
  url: string,
  pin: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-pin": pin,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "요청을 처리하지 못했어.");
  return data as T;
}

function resultCenter(items: RouletteItem[], label: string) {
  let cursor = 0;
  for (const item of items) {
    const width = Number(item.weight || 0);
    if (item.label === label) {
      return Math.min(99.5, Math.max(0.5, cursor + width / 2));
    }
    cursor += width;
  }
  return 50;
}

function labelAt(items: RouletteItem[], position: number) {
  let cursor = 0;
  for (const item of items) {
    cursor += Number(item.weight || 0);
    if (position <= cursor) return item.label;
  }
  return items[items.length - 1]?.label || "추첨 중...";
}

function itemIndexAt(items: RouletteItem[], position: number) {
  let cursor = 0;
  for (let index = 0; index < items.length; index += 1) {
    cursor += Number(items[index].weight || 0);
    if (position <= cursor) return index;
  }
  return Math.max(0, items.length - 1);
}

export default function GamePanel({
  pin,
  users,
  roulettes,
  onChanged,
  onNotice,
  discountPercent,
}: {
  pin: string;
  users: User[];
  roulettes: Roulette[];
  onChanged: () => Promise<unknown>;
  onNotice: (message: string) => void;
  discountPercent: number;
}) {
  const [configs, setConfigs] = useState<RouletteConfig[]>([]);
  const [nickname, setNickname] = useState("");
  const [openUsers, setOpenUsers] = useState(false);
  const [activeUser, setActiveUser] = useState(0);
  const [rouletteId, setRouletteId] = useState<number | null>(
    roulettes[0]?.id ?? null
  );
  const [spinCount, setSpinCount] = useState(1);

  const [cursorPct, setCursorPct] = useState(5);
  const [currentPick, setCurrentPick] = useState("추첨 대기");
  const [spinning, setSpinning] = useState(false);
  const [currentResult, setCurrentResult] = useState<SpinResult | null>(null);
  const [batchResults, setBatchResults] = useState<SpinResult[]>([]);
  const [reveal, setReveal] = useState(false);
  const [burst, setBurst] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [spinProgress, setSpinProgress] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const animationRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!rouletteId && roulettes[0]) setRouletteId(roulettes[0].id);
  }, [rouletteId, roulettes]);

  useEffect(() => {
    post<{ roulettes: RouletteConfig[] }>(
      "/api/cash-board-settings",
      pin,
      { action: "list" }
    )
      .then((data) =>
        setConfigs(data.roulettes.filter((item) => item.active))
      )
      .catch(() => {});
  }, [pin, roulettes]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const suggestions = useMemo(() => {
    const q = nickname.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter((user) => user.nickname.toLowerCase().includes(q))
      .slice(0, 6);
  }, [nickname, users]);

  const chosen = users.find((user) => user.nickname === nickname);
  const config = configs.find((item) => item.id === rouletteId);
  const fallback = roulettes.find((item) => item.id === rouletteId);
  const items = config?.items || [];
  const rawCost = Number(config?.cost ?? fallback?.cost ?? 0);
  const effectiveCost = Math.max(
    0,
    Math.round(rawCost * (100 - Math.max(0, discountPercent || 0)) / 100)
  );
  const totalCost = effectiveCost * spinCount;

  const activeIndex = itemIndexAt(items, cursorPct);
  const resultItem = currentResult
    ? items.find((item) => item.label === currentResult.label)
    : undefined;
  const rareWin =
    Boolean(resultItem) &&
    currentResult?.result_type !== "nothing" &&
    currentResult?.result_type !== "cash_loss" &&
    Number(resultItem?.weight || 0) <= 5;
  const positiveReveal = Boolean(
    reveal &&
      currentResult &&
      currentResult.result_type !== "nothing" &&
      currentResult.result_type !== "cash_loss"
  );

  const unresolvedKeeps = batchResults.some(
    (item) => item.result_type === "keep" && !item.handled
  );

  function prepareAudio() {
    if (!soundOn) return;
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();
    } catch {}
  }

  function playTone(
    frequency: number,
    durationMs: number,
    volume = 0.025,
    type: OscillatorType = "sine",
    delayMs = 0,
    endFrequency?: number
  ) {
    if (!soundOn || !audioRef.current) return;
    try {
      const context = audioRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + delayMs / 1000;
      const endAt = startAt + durationMs / 1000;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      if (endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, endFrequency),
          endAt
        );
      }

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume),
        startAt + 0.008
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.02);
    } catch {}
  }

  function playNoise(durationMs = 70, volume = 0.012, delayMs = 0) {
    if (!soundOn || !audioRef.current) return;
    try {
      const context = audioRef.current;
      const frameCount = Math.max(
        1,
        Math.floor(context.sampleRate * (durationMs / 1000))
      );
      const buffer = context.createBuffer(1, frameCount, context.sampleRate);
      const channel = buffer.getChannelData(0);

      for (let index = 0; index < frameCount; index += 1) {
        channel[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
      }

      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const startAt = context.currentTime + delayMs / 1000;
      const endAt = startAt + durationMs / 1000;

      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = 1350;
      filter.Q.value = 0.7;
      gain.gain.setValueAtTime(volume, startAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start(startAt);
      source.stop(endAt + 0.01);
    } catch {}
  }

  function playCountdownSound(step: number) {
    const base = step === 3 ? 430 : step === 2 ? 520 : 640;
    playTone(base, 105, 0.022, "triangle");
    playTone(base * 2, 72, 0.008, "sine", 8);
    playNoise(38, 0.006);
  }

  function playLaunchSound() {
    playTone(420, 180, 0.018, "sawtooth", 0, 980);
    playTone(840, 120, 0.012, "triangle", 75, 1320);
    playNoise(65, 0.009, 15);
  }

  function playTickSound(progress: number, index: number) {
    const pitch =
      310 + Math.round((1 - progress) * 300) + (index % 4) * 24;
    const tone: OscillatorType =
      index % 2 === 0 ? "square" : "triangle";
    playTone(pitch, 34, 0.0065, tone);
    if (index % 3 === 0) playNoise(24, 0.0035);
  }

  function playPositiveResultSound(
    kind: "cash" | "keep",
    rare: boolean
  ) {
    const notes =
      kind === "cash"
        ? [659, 784, 988, 1319]
        : [587, 740, 880, 1175];

    notes.forEach((note, index) => {
      playTone(
        note,
        rare ? 230 : 180,
        rare ? 0.024 : 0.018,
        index % 2 ? "triangle" : "sine",
        index * 72
      );
    });

    if (rare) {
      playTone(1568, 420, 0.015, "sine", 250);
      playNoise(160, 0.008, 220);
    }
  }

  function playNegativeResultSound(
    kind: "nothing" | "cash_loss"
  ) {
    if (kind === "cash_loss") {
      playTone(330, 180, 0.018, "sawtooth", 0, 165);
      playTone(220, 220, 0.015, "triangle", 90, 110);
      playNoise(110, 0.012, 35);
      return;
    }

    playTone(240, 150, 0.012, "triangle", 0, 180);
    playNoise(60, 0.005, 25);
  }

  function chooseUser(user: User) {
    setNickname(user.nickname);
    setOpenUsers(false);
    setActiveUser(0);
  }

  async function animateHit(
    hit: SpinResult,
    startPosition: number,
    index: number,
    total: number
  ) {
    if (index === 0) {
      setCountdown(3);
      playCountdownSound(3);
      await delay(420);
      setCountdown(2);
      playCountdownSound(2);
      await delay(420);
      setCountdown(1);
      playCountdownSound(1);
      await delay(420);
      setCountdown(null);
    } else {
      setReveal(false);
      setCurrentResult(null);
      setCurrentPick(`다음 추첨 · ${index + 1}/${total}`);
      await delay(500);
    }

    playLaunchSound();

    const target = resultCenter(items, hit.label);
    const startedAt = performance.now();
    const duration = total > 1 ? 4000 : 4900;
    const seed = Number(hit.spin_id || 0) % 7;
    const leftA = 1.2 + seed * 0.16;
    const rightA = 98.8 - seed * 0.14;
    const leftB = 2.2 + seed * 0.18;
    const rightB = 97.8 - seed * 0.16;
    const oppositeFirst = startPosition <= 50 ? rightA : leftA;
    const otherEdge = startPosition <= 50 ? leftA : rightA;
    const oppositeSecond = startPosition <= 50 ? rightB : leftB;
    const settleFrom = target < 50 ? rightB : leftB;

    const points = [
      startPosition,
      oppositeFirst,
      otherEdge,
      oppositeSecond,
      settleFrom,
      target,
    ];
    const weights = [0.14, 0.16, 0.17, 0.19, 0.34];

    function scanPosition(t: number) {
      let elapsed = 0;
      for (let pointIndex = 0; pointIndex < weights.length; pointIndex += 1) {
        const width = weights[pointIndex];
        const end = elapsed + width;
        if (t <= end || pointIndex === weights.length - 1) {
          const local = Math.max(
            0,
            Math.min(1, (t - elapsed) / width)
          );
          const eased =
            pointIndex === weights.length - 1
              ? 1 - Math.pow(1 - local, 3.35)
              : local * local * (3 - 2 * local);

          return (
            points[pointIndex] +
            (points[pointIndex + 1] - points[pointIndex]) * eased
          );
        }
        elapsed = end;
      }
      return target;
    }

    let lastTickLabel = labelAt(items, startPosition);

    await new Promise<void>((resolve) => {
      const animate = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const position = scanPosition(t);
        const nextLabel = labelAt(items, position);

        setCursorPct(position);
        setCurrentPick(nextLabel);

        if (nextLabel !== lastTickLabel) {
          playTickSound(t, itemIndexAt(items, position));
          lastTickLabel = nextLabel;
        }

        if (t < 1) {
          animationRef.current =
            window.requestAnimationFrame(animate);
          return;
        }

        setCursorPct(target);
        setCurrentPick(hit.label);
        setCurrentResult(hit);
        setReveal(true);
        setBurst((value) => value + 1);

        if (
          hit.result_type === "nothing" ||
          hit.result_type === "cash_loss"
        ) {
          playNegativeResultSound(hit.result_type);
        } else {
          const hitItem = items.find(
            (item) => item.label === hit.label
          );
          playPositiveResultSound(
            hit.result_type,
            Number(hitItem?.weight || 100) <= 5
          );
        }

        animationRef.current = null;
        resolve();
      };

      animationRef.current =
        window.requestAnimationFrame(animate);
    });

    if (index < total - 1) await delay(650);
    return target;
  }

  async function spin() {
    if (!nickname.trim() || !rouletteId || spinning) {
      if (!nickname.trim()) {
        onNotice("사용자를 먼저 선택해줘.");
      }
      return;
    }

    if (unresolvedKeeps) {
      onNotice("이전 결과의 즉시사용/킵을 먼저 선택해줘.");
      return;
    }

    if (!items.length) {
      onNotice("이 룰렛의 결과 항목을 불러오지 못했어.");
      return;
    }

    prepareAudio();
    setCurrentResult(null);
    setBatchResults([]);
    setReveal(false);
    setSpinning(true);
    setSpinProgress("");
    setCurrentPick(labelAt(items, cursorPct));
    onNotice("");

    try {
      const response = await post<SpinResponse>(
        "/api/cash-board",
        pin,
        {
          action: "spin",
          nickname: nickname.trim(),
          roulette_id: rouletteId,
          count: spinCount,
        }
      );

      const results = Array.isArray(response.results)
        ? response.results
        : [];

      let start = cursorPct;

      for (let index = 0; index < results.length; index += 1) {
        setSpinProgress(
          results.length > 1
            ? `${index + 1} / ${results.length}`
            : ""
        );
        start = await animateHit(
          results[index],
          start,
          index,
          results.length
        );
      }

      setBatchResults(results);
      setSpinning(false);
      setSpinProgress("");
      await onChanged();

      window.dispatchEvent(new Event("cash-effect-updated"));
      window.dispatchEvent(new Event("cash-timer-updated"));
    } catch (error) {
      setSpinning(false);
      setSpinProgress("");
      setCurrentPick("추첨 대기");
      onNotice(
        error instanceof Error
          ? error.message
          : "추첨 실행에 실패했어."
      );
    }
  }

  async function resolveOne(
    target: SpinResult,
    mode: "use" | "keep"
  ) {
    if (target.handled) return;

    try {
      const speech = target.label.includes("00체");
      const gag = target.label.includes("아봉");
      const smoking = target.label === "금연";

      if (mode === "use" && (speech || gag || smoking)) {
        if (!chosen) {
          onNotice("사용자를 다시 선택해줘.");
          return;
        }

        let speechSuffix: string | undefined;
        if (speech) {
          const entered = window.prompt(
            "무슨 체로 할까? 예: 냥  ·  해제하려면 '해제'"
          );
          if (entered === null) return;
          speechSuffix = entered.trim();
          if (!speechSuffix) {
            onNotice("무슨 체인지 입력해줘.");
            return;
          }
        }

        await post("/api/cash-board", pin, {
          action: "resolve_spin",
          spin_id: target.spin_id,
          mode: "keep",
        });

        const effect = await post<{
          kind: string;
          active: boolean;
          queued?: boolean;
          label: string;
        }>("/api/cash-effects", pin, {
          action: "use_special",
          user_id: chosen.id,
          item_name: target.label,
          speech_suffix: speechSuffix,
        });

        if (effect.kind === "speech_style") {
          onNotice(
            effect.queued
              ? `${effect.label}을(를) 다음 말투 대기열에 넣었어.`
              : effect.active
                ? `${effect.label} 10분 시작`
                : "말투 제한을 해제했어."
          );
        } else if (effect.kind === "smoking") {
          onNotice("금연 상태를 시작했어.");
        } else {
          onNotice(
            effect.active ? "현재 아봉중" : "아봉을 해제했어."
          );
        }

        window.dispatchEvent(new Event("cash-effect-updated"));
      } else {
        await post("/api/cash-board", pin, {
          action: "resolve_spin",
          spin_id: target.spin_id,
          mode,
        });

        onNotice(
          mode === "keep"
            ? `${target.label} 킵 저장 완료`
            : `${target.label} 즉시사용 완료`
        );
      }

      setBatchResults((current) =>
        current.map((item) =>
          item.spin_id === target.spin_id
            ? {
                ...item,
                handled: true,
                handled_mode: mode,
              }
            : item
        )
      );

      window.dispatchEvent(new Event("cash-timer-updated"));
      window.dispatchEvent(new Event("cash-queue-updated"));
      await onChanged();
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "결과 처리에 실패했어."
      );
    }
  }

  function resultHint(item: SpinResult) {
    if (item.label.includes("00체")) {
      return "사용하면 말투 입력 후 10분 시작";
    }
    if (item.label.includes("아봉")) {
      return "사용하면 아봉 상태 전환";
    }
    if (item.label === "금연") {
      return "사용하면 금연 경과시간 시작";
    }

    const configItem = items.find(
      (rouletteItem) => rouletteItem.label === item.label
    );
    if (Number(configItem?.time_limit_minutes || 0) > 0) {
      return `사용하면 ${configItem?.time_limit_minutes}분 타이머 시작`;
    }

    return "";
  }

  return (
    <section className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(30,20,60,.08)]">
      <div className="relative z-30">
        {chosen && (
          <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-600">
            {money(chosen.cash_balance)} 캐시
          </div>
        )}

        <input
          value={nickname}
          onFocus={() =>
            nickname.trim() && setOpenUsers(true)
          }
          onChange={(e) => {
            setNickname(e.target.value);
            setOpenUsers(true);
            setActiveUser(0);
          }}
          onBlur={() =>
            window.setTimeout(() => setOpenUsers(false), 90)
          }
          onKeyDown={(e) => {
            if (!openUsers || suggestions.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveUser(
                (value) => (value + 1) % suggestions.length
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveUser(
                (value) =>
                  (value - 1 + suggestions.length) %
                  suggestions.length
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              chooseUser(
                suggestions[activeUser] || suggestions[0]
              );
            } else if (e.key === "Escape") {
              setOpenUsers(false);
            }
          }}
          placeholder="닉네임 검색"
          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-28 text-sm font-bold outline-none focus:border-violet-300 focus:bg-white"
        />

        {openUsers && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-48 overflow-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">
            {suggestions.map((user, index) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  chooseUser(user);
                }}
                className={
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left " +
                  (activeUser === index
                    ? "bg-violet-50"
                    : "hover:bg-zinc-50")
                }
              >
                <span className="min-w-0 truncate text-sm font-black">
                  {user.nickname}
                  {user.title_text && (
                    <span className="ml-2 text-[9px] text-violet-500">
                      {user.title_text}
                    </span>
                  )}
                </span>
                <span className="ml-2 shrink-0 text-[11px] font-black text-violet-500">
                  {money(user.cash_balance)} 캐시
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <select
          value={rouletteId ?? ""}
          onChange={(e) => {
            setRouletteId(Number(e.target.value));
            setCurrentResult(null);
            setBatchResults([]);
            setReveal(false);
            setCurrentPick("추첨 대기");
            setCursorPct(5);
          }}
          disabled={spinning}
          className="min-w-0 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-black outline-none"
        >
          {roulettes.map((roulette) => {
            const discounted = Math.max(
              0,
              Math.round(
                roulette.cost *
                  (100 - Math.max(0, discountPercent || 0)) /
                  100
              )
            );
            return (
              <option key={roulette.id} value={roulette.id}>
                {roulette.name} · {money(discounted)} 캐시
              </option>
            );
          })}
        </select>

        <div className="flex rounded-2xl bg-zinc-100 p-1">
          {[1, 2, 3, 5].map((count) => (
            <button
              key={count}
              type="button"
              disabled={spinning}
              onClick={() => setSpinCount(count)}
              className={
                "min-w-9 rounded-xl px-2 py-2 text-xs font-black transition " +
                (spinCount === count
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-500")
              }
            >
              {count}회
            </button>
          ))}
        </div>
      </div>

      <div
        className={
          fx.stage +
          " mt-3 " +
          (spinning ? fx.stageSpinning : "")
        }
      >
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 z-[30] flex items-center justify-center bg-zinc-950/35 backdrop-blur-[1px]">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[52px] font-black leading-none text-white shadow-[0_0_45px_rgba(213,79,255,.55)] backdrop-blur-md animate-pulse">
              {countdown}
            </div>
          </div>
        )}

        <div className="relative z-[2] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black text-fuchsia-300">
              <span>실시간 추첨</span>
              {spinProgress && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/80">
                  {spinProgress}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm font-black text-white">
              {config?.name || fallback?.name || "룰렛"}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setSoundOn((value) => !value)
              }
              disabled={spinning}
              className="rounded-full bg-white/10 px-2.5 py-1.5 text-[10px] font-black text-white/75 disabled:opacity-40"
            >
              효과음 {soundOn ? "켜짐" : "꺼짐"}
            </button>

            <div className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black text-white">
              {discountPercent > 0 ? (
                <>
                  <span className="mr-1 text-emerald-300">
                    -{discountPercent}%
                  </span>
                  {money(effectiveCost)}
                </>
              ) : (
                money(effectiveCost)
              )}
              {" "}캐시
            </div>
          </div>
        </div>

        <div className={fx.trackShell}>
          <div className={fx.track}>
            {items.map((item, index) => (
              <div
                key={item.id || index}
                className={[
                  fx.segment,
                  spinning && activeIndex === index
                    ? fx.segmentActive
                    : "",
                  reveal &&
                  currentResult &&
                  item.label === currentResult.label
                    ? fx.segmentWinner
                    : "",
                  reveal &&
                  currentResult &&
                  item.label !== currentResult.label
                    ? fx.segmentDim
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  width: `${Math.max(
                    0,
                    Number(item.weight || 0)
                  )}%`,
                  background:
                    colors[index % colors.length],
                }}
                title={`${item.label} ${item.weight}%`}
              >
                <span className={fx.segmentText}>
                  {item.weight >= 9
                    ? item.label
                    : item.weight >= 6
                      ? item.label.slice(0, 2)
                      : ""}
                </span>
              </div>
            ))}

            <div
              className={
                fx.selector +
                " " +
                (spinning ? fx.selectorHot : "")
              }
              style={{ left: `${cursorPct}%` }}
            />
          </div>
        </div>

        <div className="relative z-[3] mt-2 flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <div
              key={"legend-" + (item.id || index)}
              className="flex min-w-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-black text-white"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background:
                    colors[index % colors.length],
                }}
              />
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-white/65">
                {item.weight}%
              </span>
              {Number(item.time_limit_minutes || 0) > 0 && (
                <span className="shrink-0 rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[9px] font-black text-amber-200">
                  ⏱ {item.time_limit_minutes}분
                </span>
              )}
            </div>
          ))}
        </div>

        <div className={fx.currentPick}>
          {currentPick}
        </div>

        <button
          type="button"
          onClick={spin}
          disabled={
            spinning ||
            !rouletteId ||
            unresolvedKeeps
          }
          className="relative z-[3] mt-3 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 px-4 py-3.5 text-sm font-black text-white shadow-[0_10px_30px_rgba(166,79,255,.28)] disabled:opacity-45"
        >
          {spinning
            ? "연속 추첨 중..."
            : `${spinCount}회 시작 · ${money(totalCost)} 캐시`}
        </button>

        {unresolvedKeeps && !spinning && (
          <div className="mt-2 text-center text-[10px] font-black text-amber-200">
            아래 결과의 즉시사용/킵을 먼저 선택해줘.
          </div>
        )}

        <div
          className={
            fx.flash +
            " " +
            (positiveReveal ? fx.flashOn : "")
          }
          key={"flash-" + burst}
        />

        {positiveReveal &&
          Array.from({
            length: rareWin ? 18 : 12,
          }).map((_, index) => (
            <span
              key={burst + "-" + index}
              className={fx.spark + " " + fx.sparkOn}
              style={{
                left: `${10 + (index * 7) % 82}%`,
                top: `${22 + (index * 13) % 55}%`,
                animationDelay: `${(index % 4) * 55}ms`,
                background:
                  colors[index % colors.length],
                color: colors[index % colors.length],
              }}
            />
          ))}

        {!spinning && batchResults.length > 0 && (
          <div className="relative z-[4] mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-black text-fuchsia-200">
                {batchResults.length > 1
                  ? `${batchResults.length}회 결과`
                  : "결과"}
              </div>
              <div className="text-[10px] font-black text-white/50">
                {nickname}
              </div>
            </div>

            <div className="mt-2 space-y-2">
              {batchResults.map((item, index) => {
                const hint = resultHint(item);
                const weight = items.find(
                  (rouletteItem) =>
                    rouletteItem.label === item.label
                )?.weight;
                const rare =
                  item.result_type !== "nothing" &&
                  item.result_type !== "cash_loss" &&
                  Number(weight || 100) <= 5;

                return (
                  <div
                    key={item.spin_id}
                    className="rounded-xl bg-zinc-950/30 p-3 text-white ring-1 ring-white/10"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-black">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <div className="text-[18px] font-black">
                            {item.label}
                          </div>
                          {rare && (
                            <div className="rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[9px] font-black text-fuchsia-100">
                              희귀 {weight}%
                            </div>
                          )}
                        </div>

                        {hint && (
                          <div className="mt-1 text-[10px] font-bold text-amber-100/80">
                            {hint}
                          </div>
                        )}

                        {item.result_type === "cash" && (
                          <div className="mt-1 text-[10px] font-bold text-cyan-200">
                            캐시에 자동 반영됨
                          </div>
                        )}

                        {item.result_type === "cash_loss" && (
                          <div className="mt-1 text-[10px] font-bold text-rose-200">
                            캐시 자동 차감
                          </div>
                        )}

                        {item.result_type === "nothing" && (
                          <div className="mt-1 text-[10px] font-bold text-zinc-300">
                            {item.label === "꽝"
                              ? "이번 결과는 꽝"
                              : "결과가 바로 적용됨"}
                          </div>
                        )}

                        {item.result_type === "keep" &&
                          !item.handled && (
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  resolveOne(item, "use")
                                }
                                className="rounded-xl bg-white px-3 py-2 text-xs font-black text-zinc-900"
                              >
                                즉시사용
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  resolveOne(item, "keep")
                                }
                                className="rounded-xl bg-fuchsia-500 px-3 py-2 text-xs font-black text-white"
                              >
                                킵
                              </button>
                            </div>
                          )}

                        {item.result_type === "keep" &&
                          item.handled && (
                            <div className="mt-2 inline-flex rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-black text-emerald-200">
                              {item.handled_mode === "keep"
                                ? "킵 저장 완료"
                                : "즉시사용 완료"}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

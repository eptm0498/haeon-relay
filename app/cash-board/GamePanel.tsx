"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
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
  golden_ticket?: boolean;
  golden_ticket_label?: string | null;
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

const SPECIAL_CHOICE_KEEP = "원하는 컨텐츠 룰렛 하나 킵";
const CONTENT_AUTO_KEEP = new Set([
  "오늘의 셀카",
  "음성메세지 1분",
  "원할 때 1시간 방송",
  "30분 보이스톡",
]);

const HUNDRED_CASH_AUTO_KEEP = new Set([
  "음성메세지 10초",
]);

function isHundredCashImmediate(label: string) {
  return (
    label.startsWith("퉤") ||
    label.startsWith("손가락 하트") ||
    label.startsWith("머리 위로 하트") ||
    label === "안경 쓰기/벗기" ||
    label === "200 캐시" ||
    label === "200캐시" ||
    label === "윙크" ||
    label.includes("아봉")
  );
}

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
const afterVisiblePaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 100);
      });
    });
  });

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

function ScratchTicket({
  results,
  onComplete,
}: {
  results: SpinResult[];
  onComplete: () => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const completedRef = useRef(false);
  const moveCountRef = useRef(0);
  const completeRef = useRef(onComplete);
  const [painted, setPainted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [coin, setCoin] = useState<{ x: number; y: number } | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;

    function paintCover() {
      if (!shell || !canvas) return;
      const rect = shell.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.globalCompositeOperation = "source-over";
      const gradient = context.createLinearGradient(0, 0, rect.width, rect.height);
      gradient.addColorStop(0, "#d9dce3");
      gradient.addColorStop(0.34, "#8d93a0");
      gradient.addColorStop(0.58, "#eef0f4");
      gradient.addColorStop(1, "#777d89");
      context.fillStyle = gradient;
      context.fillRect(0, 0, rect.width, rect.height);

      context.strokeStyle = "rgba(255,255,255,.26)";
      context.lineWidth = 2;
      for (let x = -rect.height; x < rect.width; x += 18) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + rect.height, rect.height);
        context.stroke();
      }

      context.textAlign = "center";
      context.fillStyle = "rgba(22,24,30,.8)";
      context.font = "900 18px system-ui, sans-serif";
      context.fillText("동전으로 긁어주세요", rect.width / 2, rect.height / 2 - 3);
      context.fillStyle = "rgba(22,24,30,.55)";
      context.font = "800 11px system-ui, sans-serif";
      context.fillText("SCRATCH TO REVEAL", rect.width / 2, rect.height / 2 + 19);
      setPainted(true);
    }

    paintCover();
    const observer = new ResizeObserver(paintCover);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [results]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }

  function scratchedPercent() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const step = Math.max(4, Math.round((window.devicePixelRatio || 1) * 8));
    let cleared = 0;
    let sampled = 0;
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        sampled += 1;
        if (pixels[(y * canvas.width + x) * 4 + 3] < 32) cleared += 1;
      }
    }
    return sampled ? (cleared / sampled) * 100 : 0;
  }

  function scratch(event: ReactPointerEvent<HTMLCanvasElement>, force = false) {
    if ((!scratchingRef.current && !force) || completedRef.current) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    const next = point(event);
    const previous = lastPointRef.current || next;
    setCoin(next);

    context.save();
    context.globalCompositeOperation = "destination-out";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 46;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    context.restore();
    lastPointRef.current = next;

    moveCountRef.current += 1;
    if (moveCountRef.current % 3 !== 0 && !force) return;
    const nextProgress = scratchedPercent();
    setProgress(Math.min(100, Math.round(nextProgress)));
    if (nextProgress >= 40) {
      completedRef.current = true;
      scratchingRef.current = false;
      setCompleted(true);
      setProgress(100);
      canvas.style.transition = "opacity 420ms ease, transform 420ms ease";
      canvas.style.opacity = "0";
      canvas.style.transform = "scale(1.02)";
      window.setTimeout(() => completeRef.current(), 430);
    }
  }

  const resultTotal = results.reduce(
    (sum, item) => sum + Number(item.cash_delta || 0),
    0
  );

  return (
    <div className="relative z-[3] mt-4">
      <div className="mb-2 flex items-center justify-between text-[10px] font-black text-white/70">
        <span>동전을 움직여 은박을 긁어줘</span>
        <span className="tabular-nums text-amber-200">{progress}%</span>
      </div>
      <div
        ref={shellRef}
        className="relative min-h-[238px] overflow-hidden rounded-[24px] border-2 border-amber-200/70 bg-[linear-gradient(145deg,#fff8d8,#fff,#ffe89c)] shadow-[0_18px_48px_rgba(0,0,0,.28)]"
      >
        <div
          aria-hidden={!completed}
          className={
            "absolute inset-0 flex flex-col p-5 text-zinc-900 transition-opacity " +
            (painted ? "opacity-100" : "opacity-0")
          }
        >
          <div className="flex items-start justify-between gap-3 border-b-2 border-dashed border-amber-300 pb-3">
            <div>
              <div className="text-[9px] font-black tracking-[.24em] text-amber-700">CASH LUCKY</div>
              <div className="mt-0.5 text-xl font-black">즉석 당첨 복권</div>
            </div>
            <div className="rounded-full bg-amber-400 px-3 py-1 text-[10px] font-black text-zinc-950">결과 {results.length}개</div>
          </div>
          <div className="grid flex-1 content-center gap-1.5 py-3">
            {results.map((item, index) => (
              <div key={item.spin_id} className="flex items-center justify-between rounded-xl bg-white/75 px-3 py-2 shadow-sm">
                <span className="text-[10px] font-black text-zinc-500">{index + 1}번째</span>
                <span className={"text-base font-black " + (Number(item.cash_delta || 0) >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t-2 border-dashed border-amber-300 pt-3 text-xs font-black">
            <span>총 결과</span>
            <span className={resultTotal >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {resultTotal >= 0 ? "+" : ""}{money(resultTotal)} 캐시
            </span>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            scratchingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            lastPointRef.current = point(event);
            scratch(event, true);
          }}
          onPointerMove={(event) => scratch(event)}
          onPointerUp={(event) => {
            scratch(event, true);
            scratchingRef.current = false;
            lastPointRef.current = null;
            setCoin(null);
          }}
          onPointerCancel={() => {
            scratchingRef.current = false;
            lastPointRef.current = null;
            setCoin(null);
          }}
          className="absolute inset-0 z-10 h-full w-full cursor-grab touch-none active:cursor-grabbing"
          aria-label="동전으로 긁는 즉석 복권"
        />

        {coin && !completed && (
          <div
            className="pointer-events-none absolute z-20 flex h-11 w-11 items-center justify-center rounded-full border-2 border-amber-100 bg-[radial-gradient(circle_at_35%_30%,#fff8bd,#e5a900_52%,#8a5a00)] text-lg font-black text-amber-950 shadow-[0_5px_12px_rgba(0,0,0,.38)]"
            style={{
              left: coin.x,
              top: coin.y,
              transform: "translate(-50%, -50%) rotate(-18deg)",
            }}
          >
            ₩
          </div>
        )}
      </div>
    </div>
  );
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
  const [visualBalance, setVisualBalance] = useState<number | null>(null);
  const [scratchBatch, setScratchBatch] = useState<{
    results: SpinResult[];
    balance: number;
  } | null>(null);
  const [goldenTicketReveal, setGoldenTicketReveal] = useState(0);
  const animationRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const goldenTicketResolveRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    if (!spinning && !scratchBatch) {
      setVisualBalance(chosen ? Number(chosen.cash_balance || 0) : null);
    }
  }, [chosen?.id, chosen?.cash_balance, spinning, scratchBatch]);

  const config = configs.find((item) => item.id === rouletteId);
  const fallback = roulettes.find((item) => item.id === rouletteId);
  const items = config?.items || [];
  const rawCost = Number(config?.cost ?? fallback?.cost ?? 0);
  const effectiveCost = Math.max(
    0,
    Math.round(rawCost * (100 - Math.max(0, discountPercent || 0)) / 100)
  );
  const totalCost = effectiveCost * spinCount;
  const activeRouletteName = config?.name || fallback?.name || "";
  const isEatRoulette = activeRouletteName === "먹어/먹지마";
  const isSmokingRoulette = activeRouletteName === "흡연/금연";
  const isCashRoulette = activeRouletteName === "캐시 룰렛";
  const isHundredCashRoulette = activeRouletteName === "100캐시 룰렛";
  const revealsPersistentState =
    isEatRoulette ||
    isSmokingRoulette ||
    activeRouletteName === "콘텐츠 룰렛";
  const busy = spinning || Boolean(scratchBatch);
  const eatResultSrc =
    currentResult?.label === "먹어"
      ? "/cash-board/eat-yes.webp"
      : currentResult?.label === "먹지마"
        ? "/cash-board/eat-no.webp"
        : null;
  const smokingResultSrc =
    currentResult?.label === "흡연"
      ? "/cash-board/smoking-yes.png"
      : currentResult?.label === "금연"
        ? "/cash-board/smoking-no.png"
        : null;

  const activeIndex = itemIndexAt(items, cursorPct);
  const resultItem = currentResult
    ? items.find((item) => item.label === currentResult.label)
    : undefined;
  const rareWin =
    currentResult?.label === SPECIAL_CHOICE_KEEP ||
    (Boolean(resultItem) &&
      currentResult?.result_type !== "nothing" &&
      currentResult?.result_type !== "cash_loss" &&
      Number(resultItem?.weight || 0) <= 5);
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
      const boostedVolume = Math.min(0.09, Math.max(0.0004, volume * 2.65));

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
        boostedVolume,
        startAt + 0.006
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
        channel[index] =
          (Math.random() * 2 - 1) * Math.pow(1 - index / frameCount, 1.15);
      }

      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const startAt = context.currentTime + delayMs / 1000;
      const endAt = startAt + durationMs / 1000;

      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = 1600;
      filter.Q.value = 0.85;
      gain.gain.setValueAtTime(Math.min(0.055, volume * 2.4), startAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start(startAt);
      source.stop(endAt + 0.01);
    } catch {}
  }

  function playCountdownSound(step: number) {
    const base = step === 3 ? 390 : step === 2 ? 500 : 650;
    playTone(base, 130, 0.028, "triangle");
    playTone(base * 2, 90, 0.014, "square", 5);
    playTone(110, 100, 0.018, "sine", 0, 82);
    playNoise(55, 0.009, 4);
  }

  function playLaunchSound() {
    playTone(260, 260, 0.028, "sawtooth", 0, 980);
    playTone(520, 220, 0.022, "triangle", 45, 1560);
    playTone(1040, 180, 0.016, "sine", 110, 1900);
    playTone(96, 210, 0.025, "sine", 0, 64);
    playNoise(100, 0.015, 25);
  }

  function playTickSound(progress: number, index: number) {
    const pitch =
      330 + Math.round((1 - progress) * 360) + (index % 5) * 28;
    const tone: OscillatorType =
      index % 2 === 0 ? "square" : "triangle";
    playTone(pitch, 42, 0.010, tone);
    if (index % 3 === 0) {
      playTone(pitch * 1.5, 30, 0.0045, "sine", 3);
    }
    if (index % 4 === 0) playNoise(28, 0.0045);
  }

  function playPositiveResultSound(
    kind: "cash" | "keep",
    rare: boolean
  ) {
    const notes =
      kind === "cash"
        ? [523, 659, 784, 988, 1319]
        : [494, 587, 740, 880, 1175];

    playTone(110, 260, rare ? 0.035 : 0.028, "sine", 0, 88);
    playNoise(90, rare ? 0.018 : 0.013, 15);

    notes.forEach((note, index) => {
      playTone(
        note,
        rare ? 310 : 230,
        rare ? 0.032 : 0.024,
        index % 2 ? "triangle" : "sine",
        index * 68
      );
      playTone(
        note * 2,
        rare ? 210 : 150,
        rare ? 0.012 : 0.008,
        "sine",
        index * 68 + 10
      );
    });

    if (rare) {
      [1568, 1760, 2093].forEach((note, index) => {
        playTone(note, 360, 0.018, "sine", 250 + index * 90);
      });
      playNoise(220, 0.014, 230);
    }
  }

  function playNegativeResultSound(
    kind: "nothing" | "cash_loss"
  ) {
    if (kind === "cash_loss") {
      playTone(330, 230, 0.026, "sawtooth", 0, 145);
      playTone(220, 280, 0.022, "triangle", 85, 92);
      playTone(78, 240, 0.024, "sine", 20, 54);
      playNoise(145, 0.016, 35);
      return;
    }

    playTone(245, 190, 0.020, "triangle", 0, 165);
    playTone(122, 200, 0.016, "sine", 35, 90);
    playNoise(85, 0.008, 20);
  }

  async function applyBroadcastTimeOutcome(label: string) {
    if (!/방송\s*(연장|단축)\s*\d+\s*분/.test(label)) return;

    await post("/api/cash-broadcast-state", pin, {
      action: "apply_outcome",
      outcome: label,
      source: "룰렛",
    });

    window.dispatchEvent(new Event("cash-broadcast-updated"));
  }

  async function showGoldenTicket(count = 1) {
    if (count <= 0) return;

    playTone(82, 520, 0.04, "sine", 0, 46);
    playTone(392, 620, 0.028, "triangle", 40, 784);
    playTone(523.25, 720, 0.028, "sine", 130, 1046.5);
    playTone(659.25, 760, 0.024, "triangle", 220, 1318.5);
    playTone(1046.5, 920, 0.02, "sine", 360, 2093);
    playNoise(260, 0.018, 20);

    setGoldenTicketReveal(count);
    await new Promise<void>((resolve) => {
      goldenTicketResolveRef.current = resolve;
    });
    await delay(180);
  }

  function confirmGoldenTicket() {
    if (goldenTicketReveal <= 0) return;

    setGoldenTicketReveal(0);
    const resolve = goldenTicketResolveRef.current;
    goldenTicketResolveRef.current = null;
    resolve?.();
  }

  function notifyRouletteActivity(active: boolean) {
    window.dispatchEvent(
      new CustomEvent("cash-roulette-activity", {
        detail: {
          active,
          blockedUntil: active ? 0 : Date.now() + 10_000,
        },
      })
    );
  }

  async function autoProcessResult(result: SpinResult) {
    if (!chosen) return result;

    if (
      result.result_type === "keep" &&
      !result.handled &&
      (
        (activeRouletteName === "콘텐츠 룰렛" &&
          CONTENT_AUTO_KEEP.has(result.label)) ||
        (isHundredCashRoulette &&
          HUNDRED_CASH_AUTO_KEEP.has(result.label))
      )
    ) {
      await post("/api/cash-board", pin, {
        action: "resolve_spin",
        spin_id: result.spin_id,
        mode: "keep",
      });

      return {
        ...result,
        handled: true,
        handled_mode: "keep" as const,
      };
    }

    if (
      isHundredCashRoulette &&
      isHundredCashImmediate(result.label)
    ) {
      if (result.result_type === "keep" && !result.handled) {
        await post("/api/cash-board", pin, {
          action: "resolve_spin",
          spin_id: result.spin_id,
          mode: "use",
        });
      }

      if (result.label.includes("아봉")) {
        await post("/api/cash-broadcast-state", pin, {
          action: "toggle_gag",
          user_id: chosen.id,
          source: "100캐시 룰렛 · 아봉",
        });
        window.dispatchEvent(new Event("cash-effect-updated"));
        window.dispatchEvent(new Event("cash-timer-updated"));
      }

      return {
        ...result,
        handled: true,
        handled_mode: "use" as const,
      };
    }

    return result;
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

    if (isEatRoulette || isSmokingRoulette) {
      setCurrentPick(isEatRoulette ? "먹을까 · 말까" : "피울까 · 말까");
    }

    const target = resultCenter(items, hit.label);
    const startedAt = performance.now();
    const duration = isHundredCashRoulette
      ? total > 1
        ? 850
        : 2800
      : total > 1
        ? 4000
        : 4900;
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
    let lastSceneBeat = -1;

    await new Promise<void>((resolve) => {
      const animate = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const position = scanPosition(t);
        const nextLabel = labelAt(items, position);

        setCursorPct(position);

        if (isEatRoulette || isSmokingRoulette) {
          setCurrentPick(isEatRoulette ? "먹을까 · 말까" : "피울까 · 말까");
          const sceneBeat = Math.floor(t * 18);
          if (sceneBeat !== lastSceneBeat) {
            playTickSound(t, sceneBeat % 6);
            lastSceneBeat = sceneBeat;
          }
        } else {
          setCurrentPick(nextLabel);
          if (nextLabel !== lastTickLabel) {
            playTickSound(t, itemIndexAt(items, position));
            lastTickLabel = nextLabel;
          }
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

        if (isEatRoulette || isSmokingRoulette) {
          playPositiveResultSound("keep", false);
        } else if (
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
            hit.label === SPECIAL_CHOICE_KEEP ||
              Number(hitItem?.weight || 100) <= 5
          );
        }

        animationRef.current = null;
        resolve();
      };

      animationRef.current =
        window.requestAnimationFrame(animate);
    });

    if (index < total - 1) {
      await delay(isHundredCashRoulette ? 180 : 650);
    }
    return target;
  }

  async function finishScratch() {
    const batch = scratchBatch;
    if (!batch) return;

    const last = batch.results[batch.results.length - 1] || null;
    const totalDelta = batch.results.reduce(
      (sum, item) => sum + Number(item.cash_delta || 0),
      0
    );
    setCurrentResult(last);
    setBatchResults(batch.results);
    setCurrentPick(
      batch.results.length > 1
        ? `총 ${totalDelta >= 0 ? "+" : ""}${money(totalDelta)} 캐시`
        : last?.label || "복권 공개 완료"
    );
    setReveal(true);
    setBurst((value) => value + 1);
    setVisualBalance(batch.balance);

    if (totalDelta < 0) {
      playNegativeResultSound("cash_loss");
    } else {
      const rare = batch.results.some((result) => {
        if (result.label === SPECIAL_CHOICE_KEEP) return true;
        const item = items.find((entry) => entry.label === result.label);
        return Number(item?.weight || 100) <= 5;
      });
      playPositiveResultSound("cash", rare);
    }

    for (const result of batch.results) {
      await applyBroadcastTimeOutcome(result.label);
    }

    await onChanged();
    window.dispatchEvent(new Event("cash-effect-updated"));
    window.dispatchEvent(new Event("cash-timer-updated"));

    const goldenCount = batch.results.filter(
      (result) => result.golden_ticket
    ).length;

    if (goldenCount > 0) {
      await delay(900);
      await showGoldenTicket(goldenCount);
    }

    setScratchBatch(null);
    notifyRouletteActivity(false);
  }

  async function spin() {
    if (!nickname.trim() || !rouletteId || busy) {
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

    notifyRouletteActivity(true);
    prepareAudio();
    setCurrentResult(null);
    setBatchResults([]);
    setReveal(false);
    setSpinning(true);
    setSpinProgress("");
    setCurrentPick(
      isEatRoulette
        ? "먹을까 · 말까"
        : isSmokingRoulette
          ? "피울까 · 말까"
        : isCashRoulette
          ? "새 복권 발급 중"
          : labelAt(items, cursorPct)
    );
    setVisualBalance(chosen ? Number(chosen.cash_balance || 0) : null);
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
      const totalNet = results.reduce(
        (sum, item) =>
          sum +
          Number(item.cash_delta || 0) -
          Number(item.cost ?? response.effective_cost ?? 0),
        0
      );
      let runningBalance = Number(response.balance || 0) - totalNet;
      setVisualBalance(runningBalance);

      if (isCashRoulette) {
        setScratchBatch({
          results,
          balance: Number(response.balance || 0),
        });
        setSpinning(false);
        setSpinProgress("");
        setCurrentPick("동전으로 복권을 긁어줘");
        return;
      }

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

        await applyBroadcastTimeOutcome(results[index].label);

        results[index] = await autoProcessResult(results[index]);

        if (revealsPersistentState) {
          await afterVisiblePaint();
          await post("/api/cash-board", pin, {
            action: "reveal_spin",
            spin_id: results[index].spin_id,
          });
          window.dispatchEvent(new Event("cash-timer-updated"));
        }

        runningBalance +=
          Number(results[index].cash_delta || 0) -
          Number(results[index].cost ?? response.effective_cost ?? 0);
        setVisualBalance(runningBalance);

        if (results[index].golden_ticket) {
          await delay(900);
          await showGoldenTicket(1);
        }
      }

      setBatchResults(results);
      setSpinning(false);
      setSpinProgress("");
      setVisualBalance(Number(response.balance || runningBalance));
      await onChanged();

      window.dispatchEvent(new Event("cash-effect-updated"));
      window.dispatchEvent(new Event("cash-timer-updated"));
      notifyRouletteActivity(false);
    } catch (error) {
      setSpinning(false);
      setSpinProgress("");
      setCurrentPick("추첨 대기");
      setVisualBalance(chosen ? Number(chosen.cash_balance || 0) : null);
      notifyRouletteActivity(false);
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
    if (
      (activeRouletteName === "콘텐츠 룰렛" &&
        CONTENT_AUTO_KEEP.has(item.label)) ||
      (isHundredCashRoulette &&
        HUNDRED_CASH_AUTO_KEEP.has(item.label))
    ) {
      return "즉시 사용 불가 항목 · 자동으로 킵에 저장";
    }
    if (
      isHundredCashRoulette &&
      isHundredCashImmediate(item.label)
    ) {
      return item.label.includes("아봉")
        ? "즉시 적용 · 기존 아봉과 동일하게 상태 전환"
        : "즉시 적용 완료";
    }
    if (item.label === SPECIAL_CHOICE_KEEP) {
      return "황금티켓 보너스 · 원하는 콘텐츠 룰렛 하나를 골라 받을 수 있어";
    }
    if (item.label.includes("00체")) {
      return "사용하면 말투 입력 후 10분 시작";
    }
    if (item.label.includes("아봉")) {
      return "추첨 즉시 아봉 상태 전환";
    }
    if (item.label === "금연") {
      return "추첨 즉시 금연 경과시간 시작";
    }
    if (item.label === "흡연") {
      return "추첨 즉시 금연 상태 해제";
    }
    if (item.label === "먹어" || item.label === "먹지마") {
      return "추첨 즉시 현재 상태에 반영";
    }

    const configItem = items.find(
      (rouletteItem) => rouletteItem.label === item.label
    );
    if (Number(configItem?.time_limit_minutes || 0) > 0) {
      return `사용하면 ${configItem?.time_limit_minutes}분 타이머 시작`;
    }

    return "";
  }

  const eventStage =
    typeof document !== "undefined"
      ? document.getElementById("cash-game-stage")
      : null;

  return (
    <section className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(30,20,60,.08)]">
      {goldenTicketReveal > 0 && eventStage && createPortal((
        <div className={fx.goldenTicketOverlay} role="status" aria-live="assertive">
          <div className={fx.goldenTicketFlash} />
          <div className={fx.goldenTicketRays} />
          <div className={fx.goldenTicketRing} />
          <div className={fx.goldenTicketRingAlt} />

          {Array.from({ length: 58 }).map((_, index) => {
            const angle = (index / 58) * Math.PI * 2;
            const distance = 180 + (index % 8) * 36;
            const palette = ["#fff8bd", "#ffd54f", "#ffb300", "#fff", "#ffea70"];

            return (
              <span
                key={"gold-" + index}
                className={fx.goldenTicketParticle}
                style={
                  {
                    "--x": `${Math.cos(angle) * distance}px`,
                    "--y": `${Math.sin(angle) * distance}px`,
                    "--delay": `${(index % 12) * 24}ms`,
                    color: palette[index % palette.length],
                  } as CSSProperties
                }
              />
            );
          })}

          <div className={fx.goldenTicketCard}>
            <div className={fx.goldenTicketInner}>
              <div className={fx.goldenTicketKicker}>SURPRISE BONUS</div>
              <div className={fx.goldenTicketTitle}>황금티켓</div>
              <div className={fx.goldenTicketSub}>
                {SPECIAL_CHOICE_KEEP}
              </div>
              <div className={fx.goldenTicketCount}>
                {goldenTicketReveal > 1
                  ? `보너스 ${goldenTicketReveal}장 획득`
                  : "보너스 1장 획득"}
              </div>
              <button
                type="button"
                onClick={confirmGoldenTicket}
                className="relative z-10 mt-4 min-w-36 rounded-2xl bg-[#5c3400] px-6 py-3 text-sm font-black text-amber-50 shadow-[0_8px_22px_rgba(92,52,0,.28)] transition active:scale-[.97]"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      ), eventStage)}
      <div className="relative z-30">
        {chosen && (
          <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-600">
            {money(visualBalance ?? chosen.cash_balance)} 캐시
          </div>
        )}

        <input
          value={nickname}
          disabled={busy}
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
          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-28 text-sm font-bold outline-none focus:border-violet-300 focus:bg-white disabled:opacity-60"
        />

        {!busy && openUsers && suggestions.length > 0 && (
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
            setSpinCount(1);
            setCurrentResult(null);
            setBatchResults([]);
            setReveal(false);
            setCurrentPick("추첨 대기");
            setCursorPct(5);
          }}
          disabled={busy}
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

        {isHundredCashRoulette ? (
          <div className="flex items-center gap-2 rounded-2xl bg-zinc-100 p-1.5">
            <input
              type="number"
              min={1}
              max={50}
              value={spinCount}
              disabled={busy}
              onChange={(event) =>
                setSpinCount(
                  Math.max(
                    1,
                    Math.min(50, Math.round(Number(event.target.value || 1)))
                  )
                )
              }
              className="w-20 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-center text-sm font-black outline-none disabled:opacity-50"
              aria-label="100캐시 룰렛 횟수"
            />
            <span className="pr-2 text-xs font-black text-zinc-500">회</span>
          </div>
        ) : (
          <div className="flex rounded-2xl bg-zinc-100 p-1">
            {[1, 2, 3, 5].map((count) => (
              <button
                key={count}
                type="button"
                disabled={busy}
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
        )}
      </div>

      <div
        id="cash-game-stage"
        className={
          fx.stage +
          " mt-3 " +
          (spinning ? fx.stageSpinning : "") +
          (positiveReveal ? " " + fx.stageWin : "")
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
              disabled={busy}
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

        {isCashRoulette ? (
          scratchBatch ? (
            <ScratchTicket
              key={scratchBatch.results.map((item) => item.spin_id).join("-")}
              results={scratchBatch.results}
              onComplete={() => void finishScratch()}
            />
          ) : (
            <div className="relative z-[3] mt-4 overflow-hidden rounded-[24px] border-2 border-dashed border-amber-300/65 bg-[linear-gradient(145deg,rgba(255,248,216,.14),rgba(255,255,255,.06))] px-5 py-10 text-center shadow-inner">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-200 bg-[radial-gradient(circle_at_35%_30%,#fff8bd,#e5a900_52%,#8a5a00)] text-2xl font-black text-amber-950 shadow-lg">
                ₩
              </div>
              <div className="mt-4 text-lg font-black text-white">캐시 즉석복권</div>
              <div className="mt-1 text-[11px] font-bold text-white/55">
                추첨하면 동전으로 긁을 복권이 발급돼
              </div>
            </div>
          )
        ) : isEatRoulette ? (
          <div className={fx.eatSceneShell}>
            <div className={fx.eatScene}>
              {reveal && eatResultSrc ? (
                <Image
                  src={eatResultSrc}
                  alt={currentResult?.label || "먹어 먹지마 결과"}
                  fill
                  sizes="(max-width: 404px) 100vw, 404px"
                  className={fx.eatResultImage}
                />
              ) : (
                <div
                  className={
                    fx.eatSprite +
                    (spinning ? " " + fx.eatSpriteSpinning : "")
                  }
                />
              )}

              <div className={fx.eatSceneGlow} />
              <div className={fx.eatChoiceBadges}>
                <span>먹어 50%</span>
                <span>먹지마 50%</span>
              </div>

              {spinning && (
                <div className={fx.eatMotionLabel}>
                  음식이 입 안팎을 오가는 중
                </div>
              )}
            </div>
          </div>
        ) : isSmokingRoulette ? (
          <div className={fx.smokingSceneShell}>
            <div className={fx.smokingScene}>
              {reveal && smokingResultSrc ? (
                <Image
                  src={smokingResultSrc}
                  alt={currentResult?.label || "흡연 금연 결과"}
                  fill
                  sizes="(max-width: 404px) 100vw, 404px"
                  className={fx.smokingResultImage}
                />
              ) : (
                <>
                  <div
                    className={
                      fx.smokingAnimationArt +
                      (spinning ? " " + fx.smokingAnimationSpinning : "")
                    }
                  />
                  <div
                    className={
                      fx.smokingTokenRig +
                      (spinning ? " " + fx.smokingTokenRigSpinning : "")
                    }
                  >
                    <div className={fx.smokingDecisionToken}>
                      <div className={fx.smokingTokenFront}>
                        <div className={fx.smokingCigaretteIcon} />
                      </div>
                      <div className={fx.smokingTokenBack}>
                        <div className={fx.smokingNoRing}>
                          <div className={fx.smokingCigaretteIcon} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={fx.smokingEnergyRing} />
                  <div className={fx.smokingEnergyRingAlt} />
                </>
              )}

              <div className={fx.smokingSceneGlow} />
              {!reveal && (
                <div className={fx.smokingChoiceBadges}>
                  <span>흡연</span>
                  <span>금연</span>
                </div>
              )}

              {spinning && (
                <div className={fx.smokingMotionLabel}>
                  결정 토큰 회전 중
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}

        <div className={fx.currentPick}>
          {currentPick}
        </div>

        <button
          type="button"
          onClick={spin}
          disabled={
            busy ||
            !rouletteId ||
            unresolvedKeeps
          }
          className="relative z-[3] mt-3 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 px-4 py-3.5 text-sm font-black text-white shadow-[0_10px_30px_rgba(166,79,255,.28)] disabled:opacity-45"
        >
          {spinning
            ? isCashRoulette
              ? "복권 발급 중..."
              : "연속 추첨 중..."
            : scratchBatch
              ? "복권을 먼저 끝까지 긁어줘"
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

        {positiveReveal && (
          <>
            <span className={fx.burstCore} key={"core-" + burst} />
            <span className={fx.burstRing} key={"ring-a-" + burst} />
            <span className={fx.burstRingAlt} key={"ring-b-" + burst} />
            {Array.from({
              length: rareWin ? 36 : 24,
            }).map((_, index) => (
              <span
                key={burst + "-" + index}
                className={fx.spark + " " + fx.sparkOn}
                style={{
                  left: `${6 + (index * 11) % 90}%`,
                  top: `${14 + (index * 17) % 70}%`,
                  animationDelay: `${(index % 7) * 38}ms`,
                  animationDuration: `${720 + (index % 5) * 90}ms`,
                  background:
                    colors[index % colors.length],
                  color: colors[index % colors.length],
                }}
              />
            ))}
          </>
        )}

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

            {batchResults.some(
              (item) =>
                item.result_type === "cash" ||
                item.result_type === "cash_loss" ||
                item.result_type === "nothing"
            ) && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <div className="rounded-xl bg-white/8 px-2 py-2 text-center">
                  <div className="text-[8px] font-black text-white/45">총 사용</div>
                  <div className="mt-0.5 text-[11px] font-black text-white">
                    -{money(
                      batchResults.reduce(
                        (sum, item) => sum + Number(item.cost || 0),
                        0
                      )
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-white/8 px-2 py-2 text-center">
                  <div className="text-[8px] font-black text-white/45">결과 반영</div>
                  <div className="mt-0.5 text-[11px] font-black text-cyan-200">
                    {batchResults.reduce(
                      (sum, item) => sum + Number(item.cash_delta || 0),
                      0
                    ) >= 0
                      ? "+"
                      : ""}
                    {money(
                      batchResults.reduce(
                        (sum, item) => sum + Number(item.cash_delta || 0),
                        0
                      )
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-white/8 px-2 py-2 text-center">
                  <div className="text-[8px] font-black text-white/45">순변동</div>
                  {(() => {
                    const net = batchResults.reduce(
                      (sum, item) =>
                        sum +
                        Number(item.cash_delta || 0) -
                        Number(item.cost || 0),
                      0
                    );
                    return (
                      <div
                        className={
                          "mt-0.5 text-[11px] font-black " +
                          (net >= 0 ? "text-emerald-200" : "text-rose-200")
                        }
                      >
                        {net >= 0 ? "+" : ""}
                        {money(net)}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="mt-2 space-y-2">
              {batchResults.map((item, index) => {
                const hint = resultHint(item);
                const weight = items.find(
                  (rouletteItem) =>
                    rouletteItem.label === item.label
                )?.weight;
                const specialChoice =
                  item.label === SPECIAL_CHOICE_KEEP;
                const rare =
                  specialChoice ||
                  (item.result_type !== "nothing" &&
                    item.result_type !== "cash_loss" &&
                    Number(weight || 100) <= 5);

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
                              {specialChoice ? "특수 5%" : `희귀 ${weight}%`}
                            </div>
                          )}
                        </div>

                        {hint && (
                          <div className="mt-1 text-[10px] font-bold text-amber-100/80">
                            {hint}
                          </div>
                        )}

                        {(item.result_type === "cash" ||
                          item.result_type === "cash_loss" ||
                          item.result_type === "nothing") && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] font-black">
                            <span className="rounded-full bg-white/10 px-2 py-1 text-white/65">
                              사용 -{money(Number(item.cost || 0))}
                            </span>
                            {Number(item.cash_delta || 0) !== 0 && (
                              <span
                                className={
                                  "rounded-full px-2 py-1 " +
                                  (Number(item.cash_delta || 0) > 0
                                    ? "bg-cyan-400/15 text-cyan-200"
                                    : "bg-rose-400/15 text-rose-200")
                                }
                              >
                                결과 {Number(item.cash_delta || 0) > 0 ? "+" : ""}
                                {money(Number(item.cash_delta || 0))}
                              </span>
                            )}
                            {(() => {
                              const net =
                                Number(item.cash_delta || 0) -
                                Number(item.cost || 0);
                              return (
                                <span
                                  className={
                                    "rounded-full px-2 py-1 " +
                                    (net >= 0
                                      ? "bg-emerald-400/15 text-emerald-200"
                                      : "bg-rose-400/15 text-rose-200")
                                  }
                                >
                                  순변동 {net >= 0 ? "+" : ""}
                                  {money(net)}
                                </span>
                              );
                            })()}
                          </div>
                        )}

                        {item.result_type === "cash" && (
                          <div className="mt-1 text-[10px] font-bold text-cyan-200">
                            당첨 캐시까지 잔액에 반영 완료
                          </div>
                        )}

                        {item.result_type === "cash_loss" && (
                          <div className="mt-1 text-[10px] font-bold text-rose-200">
                            룰렛 비용과 추가 차감 모두 반영 완료
                          </div>
                        )}

                        {item.result_type === "nothing" && (
                          <div className="mt-1 text-[10px] font-bold text-zinc-300">
                            {item.label === "꽝"
                              ? "이번 회차는 룰렛 비용만 차감"
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
                              {item.label === SPECIAL_CHOICE_KEEP
                                ? "선택권 저장 완료"
                                : item.handled_mode === "keep"
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

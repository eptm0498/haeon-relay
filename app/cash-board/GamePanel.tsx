"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import fx from "./effects.module.css";

type User = { id: number; nickname: string; cash_balance: number };
type Roulette = { id: number; name: string; cost: number };
type RouletteItem = {
  id: number;
  label: string;
  result_type: "keep" | "cash" | "nothing";
  cash_amount: number;
  weight: number;
  time_limit_minutes?: number;
  sort_order: number;
};
type RouletteConfig = Roulette & { active: boolean; items: RouletteItem[] };
type SpinResult = {
  ok: boolean;
  spin_id: number;
  label: string;
  result_type: "keep" | "cash" | "nothing";
  balance: number;
};

const colors = ["#ff4fa3", "#7b5cff", "#24c8ff", "#ffcc33", "#ff715b", "#46d99a", "#ff8bd5", "#4a8cff"];
const money = (v: number) => Number(v || 0).toLocaleString("ko-KR");
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function post<T>(url: string, pin: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-pin": pin },
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
    if (item.label === label) return Math.min(97, Math.max(3, cursor + width / 2));
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

function reflectInto(value: number, min: number, max: number) {
  let next = value;
  for (let i = 0; i < 8 && (next < min || next > max); i += 1) {
    if (next > max) next = max - (next - max);
    if (next < min) next = min + (min - next);
  }
  return Math.min(max, Math.max(min, next));
}

export default function GamePanel({
  pin,
  users,
  roulettes,
  onChanged,
  onNotice,
}: {
  pin: string;
  users: User[];
  roulettes: Roulette[];
  onChanged: () => Promise<unknown>;
  onNotice: (message: string) => void;
}) {
  const [configs, setConfigs] = useState<RouletteConfig[]>([]);
  const [nickname, setNickname] = useState("");
  const [openUsers, setOpenUsers] = useState(false);
  const [activeUser, setActiveUser] = useState(0);
  const [rouletteId, setRouletteId] = useState<number | null>(roulettes[0]?.id ?? null);

  const [cursorPct, setCursorPct] = useState(5);
  const [currentPick, setCurrentPick] = useState("추첨 대기");
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [reveal, setReveal] = useState(false);
  const [burst, setBurst] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const animationRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!rouletteId && roulettes[0]) setRouletteId(roulettes[0].id);
  }, [rouletteId, roulettes]);

  useEffect(() => {
    post<{ roulettes: RouletteConfig[] }>("/api/cash-board-settings", pin, { action: "list" })
      .then((data) => setConfigs(data.roulettes.filter((item) => item.active)))
      .catch(() => {});
  }, [pin, roulettes]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) window.cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const suggestions = useMemo(() => {
    const q = nickname.trim().toLowerCase();
    if (!q) return [];
    return users.filter((user) => user.nickname.toLowerCase().includes(q)).slice(0, 6);
  }, [nickname, users]);

  const chosen = users.find((user) => user.nickname === nickname);
  const config = configs.find((item) => item.id === rouletteId);
  const fallback = roulettes.find((item) => item.id === rouletteId);
  const items = config?.items || [];
  const timedResult = result
    ? items.find((item) => item.label === result.label && Number(item.time_limit_minutes || 0) > 0)
    : undefined;
  const activeIndex = itemIndexAt(items, cursorPct);
  const resultItem = result ? items.find((item) => item.label === result.label) : undefined;
  const rareWin =
    Boolean(resultItem) &&
    result?.result_type !== "nothing" &&
    Number(resultItem?.weight || 0) <= 5;
  const positiveReveal = Boolean(reveal && result && result.result_type !== "nothing");

  function prepareAudio() {
    if (!soundOn) return;
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();
    } catch {}
  }

  function playTone(frequency: number, durationMs: number, volume = 0.025) {
    if (!soundOn || !audioRef.current) return;
    try {
      const context = audioRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + durationMs / 1000);
    } catch {}
  }

  function chooseUser(user: User) {
    setNickname(user.nickname);
    setOpenUsers(false);
    setActiveUser(0);
  }

  async function spin() {
    if (!nickname.trim() || !rouletteId || spinning) {
      if (!nickname.trim()) onNotice("사용자를 먼저 선택해줘.");
      return;
    }
    if (!items.length) {
      onNotice("이 룰렛의 결과 항목을 불러오지 못했어.");
      return;
    }

    prepareAudio();
    setResult(null);
    setReveal(false);
    setSpinning(true);
    setCurrentPick(labelAt(items, cursorPct));
    onNotice("");

    try {
      const hit = await post<SpinResult>("/api/cash-board", pin, {
        action: "spin",
        nickname: nickname.trim(),
        roulette_id: rouletteId,
      });

      setCountdown(3);
      playTone(520, 90, 0.018);
      await delay(420);
      setCountdown(2);
      playTone(590, 90, 0.018);
      await delay(420);
      setCountdown(1);
      playTone(680, 100, 0.02);
      await delay(420);
      setCountdown(null);
      playTone(820, 110, 0.022);

      const start = cursorPct;
      const target = resultCenter(items, hit.label);
      const startedAt = performance.now();
      const duration = 4600;
      const cycles = 5.15;
      let lastTickLabel = labelAt(items, start);

      const animate = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const smooth = t * t * (3 - 2 * t);
        const base = start + (target - start) * smooth;

        const envelope =
          52 *
          Math.pow(Math.max(0, 1 - t), 0.74) *
          Math.pow(Math.max(0.0001, Math.sin(Math.PI * t)), 0.34);

        const phase =
          Math.PI * 2 * cycles * (1 - Math.pow(1 - t, 1.72));

        const raw = base + envelope * Math.sin(phase);
        const position = reflectInto(raw, 3, 97);

        const nextLabel = labelAt(items, position);
        setCursorPct(position);
        setCurrentPick(nextLabel);

        if (nextLabel !== lastTickLabel) {
          const pitch = 360 + Math.round((1 - t) * 260);
          playTone(pitch, 42, 0.012);
          lastTickLabel = nextLabel;
        }

        if (t < 1) {
          animationRef.current = window.requestAnimationFrame(animate);
          return;
        }

        setCursorPct(target);
        setCurrentPick(hit.label);
        setResult(hit);
        setReveal(true);
        setBurst((value) => value + 1);
        if (hit.result_type === "nothing") {
          playTone(180, 120, 0.012);
        } else {
          playTone(880, 110, 0.024);
          window.setTimeout(() => playTone(1175, 170, 0.022), 105);
        }
        setSpinning(false);
        animationRef.current = null;
        void onChanged();
      };

      animationRef.current = window.requestAnimationFrame(animate);
    } catch (error) {
      setSpinning(false);
      setCurrentPick("추첨 대기");
      onNotice(error instanceof Error ? error.message : "추첨 실행에 실패했어.");
    }
  }

  async function resolve(mode: "use" | "keep") {
    if (!result) return;
    try {
      await post("/api/cash-board", pin, {
        action: "resolve_spin",
        spin_id: result.spin_id,
        mode,
      });
      if (mode === "use") {
        window.dispatchEvent(new Event("cash-timer-updated"));
      }
      onNotice(mode === "keep" ? `${result.label} 킵 저장 완료` : `${result.label} 즉시사용 완료`);
      setResult(null);
      setReveal(false);
      setCurrentPick("추첨 대기");
      setCursorPct(5);
      await onChanged();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "결과 처리에 실패했어.");
    }
  }

  return (
    <section className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(30,20,60,.08)]">
      <div className="text-[11px] font-black text-violet-600">오늘의 룰렛</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">룰렛</h2>
          <p className="mt-0.5 text-xs font-medium text-zinc-400">닉네임 고르고 바로 시작하면 돼.</p>
        </div>
        {chosen && (
          <div className="shrink-0 rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-black text-violet-600">
            {money(chosen.cash_balance)} 캐시
          </div>
        )}
      </div>

      <div className="relative z-30 mt-3">
        <input
          value={nickname}
          onFocus={() => nickname.trim() && setOpenUsers(true)}
          onChange={(e) => {
            setNickname(e.target.value);
            setOpenUsers(true);
            setActiveUser(0);
          }}
          onBlur={() => window.setTimeout(() => setOpenUsers(false), 90)}
          onKeyDown={(e) => {
            if (!openUsers || suggestions.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveUser((value) => (value + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveUser((value) => (value - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              chooseUser(suggestions[activeUser] || suggestions[0]);
            } else if (e.key === "Escape") {
              setOpenUsers(false);
            }
          }}
          placeholder="닉네임 검색"
          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-bold outline-none focus:border-violet-300 focus:bg-white"
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
                  (activeUser === index ? "bg-violet-50" : "hover:bg-zinc-50")
                }
              >
                <span className="truncate text-sm font-black">{user.nickname}</span>
                <span className="ml-2 shrink-0 text-[11px] font-black text-violet-500">
                  {money(user.cash_balance)} 캐시
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <select
        value={rouletteId ?? ""}
        onChange={(e) => {
          setRouletteId(Number(e.target.value));
          setResult(null);
          setReveal(false);
          setCurrentPick("추첨 대기");
          setCursorPct(5);
        }}
        disabled={spinning}
        className="mt-3 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-black outline-none"
      >
        {roulettes.map((roulette) => (
          <option key={roulette.id} value={roulette.id}>
            {roulette.name} · {money(roulette.cost)} 캐시
          </option>
        ))}
      </select>

      <div className={fx.stage + " mt-3 " + (spinning ? fx.stageSpinning : "")}>
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 z-[30] flex items-center justify-center bg-zinc-950/35 backdrop-blur-[1px]">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[52px] font-black leading-none text-white shadow-[0_0_45px_rgba(213,79,255,.55)] backdrop-blur-md animate-pulse">
              {countdown}
            </div>
          </div>
        )}
        <div className="relative z-[2] flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black text-fuchsia-300">실시간 추첨</div>
            <div className="mt-1 text-sm font-black text-white">{config?.name || fallback?.name || "룰렛"}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSoundOn((value) => !value)}
              disabled={spinning}
              className="rounded-full bg-white/10 px-2.5 py-1.5 text-[10px] font-black text-white/75 disabled:opacity-40"
            >
              효과음 {soundOn ? "켜짐" : "꺼짐"}
            </button>
            <div className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black text-white">
              1회 {money(config?.cost ?? fallback?.cost ?? 0)} 캐시
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
                  spinning && activeIndex === index ? fx.segmentActive : "",
                  reveal && result && item.label === result.label ? fx.segmentWinner : "",
                  reveal && result && item.label !== result.label ? fx.segmentDim : "",
                ].filter(Boolean).join(" ")}
                style={{
                  width: `${Math.max(0, Number(item.weight || 0))}%`,
                  background: colors[index % colors.length],
                }}
                title={`${item.label} ${item.weight}%`}
              >
                <span className={fx.segmentText}>
                  {item.weight >= 9 ? item.label : item.weight >= 6 ? item.label.slice(0, 2) : ""}
                </span>
              </div>
            ))}
            <div
              className={fx.selector + " " + (spinning ? fx.selectorHot : "")}
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
                style={{ background: colors[index % colors.length] }}
              />
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-white/65">{item.weight}%</span>
              {Number(item.time_limit_minutes || 0) > 0 && (
                <span className="shrink-0 rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[9px] font-black text-amber-200">
                  ⏱ {item.time_limit_minutes}분
                </span>
              )}
            </div>
          ))}
        </div>

        <div className={fx.currentPick}>{currentPick}</div>

        <button
          type="button"
          onClick={spin}
          disabled={spinning || !rouletteId}
          className="relative z-[3] mt-3 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 px-4 py-3.5 text-sm font-black text-white shadow-[0_10px_30px_rgba(166,79,255,.28)] disabled:opacity-45"
        >
          {spinning ? "추첨 중..." : `시작하기 · ${money(config?.cost ?? fallback?.cost ?? 0)} 캐시`}
        </button>

        <div className={fx.flash + " " + (positiveReveal ? fx.flashOn : "")} key={"flash-" + burst} />
        {positiveReveal && Array.from({ length: rareWin ? 18 : 12 }).map((_, index) => (
          <span
            key={burst + "-" + index}
            className={fx.spark + " " + fx.sparkOn}
            style={{
              left: `${10 + (index * 7) % 82}%`,
              top: `${22 + (index * 13) % 55}%`,
              animationDelay: `${(index % 4) * 55}ms`,
              background: colors[index % colors.length],
              color: colors[index % colors.length],
            }}
          />
        ))}

        {reveal && result && (
          <div
            className={
              (result.result_type === "nothing" ? fx.lossResult : fx.resultPop) +
              " relative z-[4] mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 text-center backdrop-blur"
            }
          >
            <div className="text-[11px] font-black text-fuchsia-200">
              {result.result_type === "nothing" ? "결과" : "당첨 결과"}
            </div>
            {rareWin && <div className={fx.rareBadge + " mt-2"}>희귀 당첨 · {resultItem?.weight}%</div>}
            <div className="mt-1 text-[28px] font-black leading-tight text-white">{result.label}</div>
            <div className="mt-1 text-[11px] font-black text-cyan-200/80">
              {nickname}님이 오늘 목표를 {money(config?.cost ?? fallback?.cost ?? 0)}만큼 채웠어요
            </div>
            {timedResult && (
              <div className="mt-2 rounded-xl bg-amber-300/10 px-3 py-2 text-[11px] font-black text-amber-200 ring-1 ring-amber-200/20">
                사용하면 {timedResult.time_limit_minutes}분 타이머가 바로 시작돼
              </div>
            )}

            {result.result_type === "keep" && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => resolve("use")}
                  className="rounded-xl bg-white px-3 py-2.5 text-sm font-black text-zinc-900"
                >
                  즉시사용
                </button>
                <button
                  type="button"
                  onClick={() => resolve("keep")}
                  className="rounded-xl bg-fuchsia-500 px-3 py-2.5 text-sm font-black text-white"
                >
                  킵
                </button>
              </div>
            )}

            {result.result_type === "cash" && (
              <div className="mt-2 text-xs font-bold text-cyan-200">당첨 캐시는 자동으로 반영됐어.</div>
            )}

            {result.result_type === "nothing" && (
              <div className="mt-2 text-xs font-bold text-zinc-300">이번 판은 꽝.</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

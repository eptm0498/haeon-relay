"use client";

import { useEffect, useMemo, useState } from "react";
import fx from "./effects.module.css";

type User = { id: number; nickname: string; cash_balance: number };
type Roulette = { id: number; name: string; cost: number };
type RouletteItem = {
  id: number;
  label: string;
  result_type: "keep" | "cash" | "nothing";
  cash_amount: number;
  weight: number;
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
  const [cursorDuration, setCursorDuration] = useState(0);
  const [cursorEase, setCursorEase] = useState("linear");
  const [currentPick, setCurrentPick] = useState("추첨 대기");
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [reveal, setReveal] = useState(false);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (!rouletteId && roulettes[0]) setRouletteId(roulettes[0].id);
  }, [rouletteId, roulettes]);

  useEffect(() => {
    post<{ roulettes: RouletteConfig[] }>("/api/cash-board-settings", pin, { action: "list" })
      .then((data) => setConfigs(data.roulettes.filter((item) => item.active)))
      .catch(() => {});
  }, [pin, roulettes]);

  const suggestions = useMemo(() => {
    const q = nickname.trim().toLowerCase();
    if (!q) return [];
    return users.filter((user) => user.nickname.toLowerCase().includes(q)).slice(0, 6);
  }, [nickname, users]);

  const chosen = users.find((user) => user.nickname === nickname);
  const config = configs.find((item) => item.id === rouletteId);
  const fallback = roulettes.find((item) => item.id === rouletteId);
  const items = config?.items || [];

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

    setResult(null);
    setReveal(false);
    setSpinning(true);
    setCurrentPick("추첨 중...");
    onNotice("");

    try {
      const hit = await post<SpinResult>("/api/cash-board", pin, {
        action: "spin",
        nickname: nickname.trim(),
        roulette_id: rouletteId,
      });

      let itemIndex = 0;
      const ticker = window.setInterval(() => {
        itemIndex = (itemIndex + 1) % items.length;
        setCurrentPick(items[itemIndex]?.label || "추첨 중...");
      }, 95);

      const move = (after: number, to: number, duration: number, ease = "linear") => {
        window.setTimeout(() => {
          setCursorDuration(duration);
          setCursorEase(ease);
          setCursorPct(to);
        }, after);
      };

      move(0, 95, 320);
      move(340, 5, 390);
      move(750, 94, 450);
      move(1220, 7, 520);
      move(1760, 90, 620);
      move(2400, 12, 700);

      const target = resultCenter(items, hit.label);
      move(3120, target, 1100, "cubic-bezier(.08,.72,.12,1)");

      window.setTimeout(() => {
        window.clearInterval(ticker);
        setCurrentPick(hit.label);
        setResult(hit);
        setReveal(true);
        setBurst((value) => value + 1);
        setSpinning(false);
        void onChanged();
      }, 4280);
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
      onNotice(mode === "keep" ? `${result.label} 킵 저장 완료` : `${result.label} 즉시사용 완료`);
      setResult(null);
      setReveal(false);
      setCurrentPick("추첨 대기");
      setCursorDuration(350);
      setCursorEase("ease");
      setCursorPct(5);
      await onChanged();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "결과 처리에 실패했어.");
    }
  }

  return (
    <section className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(30,20,60,.08)]">
      <div className="text-[11px] font-black text-violet-600">무작위 추첨</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">룰렛 게임</h2>
          <p className="mt-0.5 text-xs font-medium text-zinc-400">선택 막대가 좌우로 왕복하다 실제 당첨 결과에 멈춰.</p>
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
          setCursorDuration(0);
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

      <div className={fx.stage + " mt-3"}>
        <div className="relative z-[2] flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black text-fuchsia-300">실시간 추첨</div>
            <div className="mt-1 text-sm font-black text-white">{config?.name || fallback?.name || "룰렛"}</div>
          </div>
          <div className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black text-white">
            1회 {money(config?.cost ?? fallback?.cost ?? 0)} 캐시
          </div>
        </div>

        <div className={fx.trackShell}>
          <div className={fx.track}>
            {items.map((item, index) => (
              <div
                key={item.id || index}
                className={fx.segment}
                style={{
                  width: `${Math.max(0, Number(item.weight || 0))}%`,
                  background: colors[index % colors.length],
                }}
                title={`${item.label} ${item.weight}%`}
              >
                <span className={fx.segmentText}>
                  {item.weight >= 8 ? item.label : item.weight >= 4 ? item.label.slice(0, 3) : ""}
                </span>
              </div>
            ))}
            <div
              className={fx.selector + " " + (spinning ? fx.selectorHot : "")}
              style={{
                left: `${cursorPct}%`,
                transitionDuration: `${cursorDuration}ms`,
                transitionTimingFunction: cursorEase,
              }}
            />
          </div>
        </div>

        <div className={fx.currentPick}>{currentPick}</div>

        <button
          type="button"
          onClick={spin}
          disabled={spinning || !rouletteId}
          className="relative z-[3] mt-3 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 px-4 py-3.5 text-sm font-black text-white shadow-[0_10px_30px_rgba(166,79,255,.28)] disabled:opacity-45"
        >
          {spinning ? "추첨 중..." : "추첨 시작"}
        </button>

        <div className={fx.flash + " " + (reveal ? fx.flashOn : "")} key={"flash-" + burst} />
        {reveal && Array.from({ length: 12 }).map((_, index) => (
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
          <div className={fx.resultPop + " relative z-[4] mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 text-center backdrop-blur"}>
            <div className="text-[11px] font-black text-fuchsia-200">당첨 결과</div>
            <div className="mt-1 text-[28px] font-black leading-tight text-white">{result.label}</div>

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

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

function wheelGradient(items: RouletteItem[]) {
  let cursor = 0;
  const stops = items.map((item, index) => {
    const start = cursor;
    cursor += Number(item.weight) * 3.6;
    return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
  });
  return `conic-gradient(${stops.join(",")})`;
}

function targetAngle(items: RouletteItem[], label: string) {
  let cursor = 0;
  for (const item of items) {
    const width = Number(item.weight) * 3.6;
    const center = cursor + width / 2;
    if (item.label === label) return (360 - center + 360) % 360;
    cursor += width;
  }
  return 0;
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
  const [rotation, setRotation] = useState(0);
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
  const wheelBg = items.length
    ? wheelGradient(items)
    : "conic-gradient(#ff4fa3 0deg 90deg,#7b5cff 90deg 180deg,#24c8ff 180deg 270deg,#ffcc33 270deg 360deg)";

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

    setResult(null);
    setReveal(false);
    setSpinning(true);
    onNotice("");

    try {
      const hit = await post<SpinResult>("/api/cash-board", pin, {
        action: "spin",
        nickname: nickname.trim(),
        roulette_id: rouletteId,
      });

      const target = targetAngle(items, hit.label);
      setRotation((previous) => {
        const current = ((previous % 360) + 360) % 360;
        const delta = (target - current + 360) % 360;
        return previous + 1800 + delta;
      });

      window.setTimeout(() => {
        setResult(hit);
        setReveal(true);
        setBurst((value) => value + 1);
        setSpinning(false);
        void onChanged();
      }, 3300);
    } catch (error) {
      setSpinning(false);
      onNotice(error instanceof Error ? error.message : "룰렛 실행에 실패했어.");
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
      await onChanged();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "결과 처리에 실패했어.");
    }
  }

  return (
    <section className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(30,20,60,.08)]">
      <div className="text-[10px] font-black tracking-[.2em] text-violet-500">RANDOM PLAY</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">룰렛 게임</h2>
          <p className="mt-0.5 text-xs font-medium text-zinc-400">사용자를 고르고 돌리면 결과 위치에 실제로 멈춰.</p>
        </div>
        {chosen && (
          <div className="shrink-0 rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-black text-violet-600">
            {money(chosen.cash_balance)} CASH
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
              setActiveUser((v) => (v + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveUser((v) => (v - 1 + suggestions.length) % suggestions.length);
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
                  {money(user.cash_balance)} CASH
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
        }}
        disabled={spinning}
        className="mt-3 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-black outline-none"
      >
        {roulettes.map((roulette) => (
          <option key={roulette.id} value={roulette.id}>
            {roulette.name} · {money(roulette.cost)} CASH
          </option>
        ))}
      </select>

      <div className={fx.stage + " mt-3 " + (spinning ? fx.isSpinning : "")}>
        <div className="relative z-[2] flex items-center justify-between">
          <div>
            <div className="text-[9px] font-black tracking-[.22em] text-fuchsia-300">LIVE SPIN</div>
            <div className="mt-1 text-sm font-black text-white">{config?.name || fallback?.name || "룰렛"}</div>
          </div>
          <div className="rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black text-white">
            {money(config?.cost ?? fallback?.cost ?? 0)} CASH
          </div>
        </div>

        <div className={fx.wheelWrap}>
          <div className={fx.pointer} />
          <div className={fx.pulseRing} />
          <div
            className={fx.wheel + " " + (spinning ? fx.spinning : "")}
            style={{
              background: wheelBg,
              transform: `rotate(${rotation}deg)`,
              transitionDuration: spinning ? "3200ms" : "450ms",
              transitionTimingFunction: spinning ? "cubic-bezier(.08,.72,.08,1)" : "ease",
            }}
          >
            {items.map((item, index) => {
              const before = items.slice(0, index).reduce((sum, current) => sum + current.weight, 0);
              const center = (before + item.weight / 2) * 3.6;
              return (
                <span
                  key={item.id || index}
                  className={fx.label}
                  style={{
                    transform: `rotate(${center}deg) translateY(-84px) rotate(${-center}deg)`,
                  }}
                >
                  {item.label}
                </span>
              );
            })}
            <div className={fx.center}>CASH<br />SPIN</div>
          </div>
        </div>

        <button
          type="button"
          onClick={spin}
          disabled={spinning || !rouletteId}
          className="relative z-[3] w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 px-4 py-3.5 text-sm font-black text-white shadow-[0_10px_30px_rgba(166,79,255,.28)] disabled:opacity-45"
        >
          {spinning ? "두구두구..." : "룰렛 돌리기"}
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
            }}
          />
        ))}

        {reveal && result && (
          <div className={fx.resultPop + " relative z-[4] mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 text-center backdrop-blur"}>
            <div className="text-[9px] font-black tracking-[.22em] text-fuchsia-200">RESULT</div>
            <div className="mt-1 text-2xl font-black text-white">{result.label}</div>

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
              <div className="mt-2 text-xs font-bold text-cyan-200">당첨 CASH는 자동으로 반영됐어.</div>
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

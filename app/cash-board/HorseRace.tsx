"use client";

import { useEffect, useRef, useState } from "react";
import style from "./horse-race.module.css";

const horses = ["날쌘돌이", "태풍", "번개", "질풍", "흑마"];
const chances = [30, 25, 20, 15, 10];
const odds = [3.07, 3.68, 4.6, 6.13, 9.2];
const multipliers = [307, 368, 460, 613, 920];
type Result = { order: number[]; winner: number; pick: number; wager: number; balance: number; prize: number };
const money = (n: number) => n.toLocaleString("ko-KR");

export default function HorseRace({ pin, nickname, balance, onChanged, onNotice, onBusy }: {
  pin: string;
  nickname: string;
  balance: number | null;
  onChanged: () => Promise<unknown>;
  onNotice: (message: string) => void;
  onBusy: (value: boolean) => void;
}) {
  const [pick, setPick] = useState(1);
  const [wager, setWager] = useState("5000");
  const [running, setRunning] = useState(false);
  const [positions, setPositions] = useState([0, 0, 0, 0, 0]);
  const [ranking, setRanking] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    onBusy(false);
  }, [onBusy]);

  async function start() {
    if (running) return;
    if (!nickname.trim()) return onNotice("사용자를 먼저 선택해줘.");
    if (balance === null) return onNotice("목록에서 사용자를 선택해줘.");
    const amount = Number(wager);
    if (!Number.isSafeInteger(amount) || amount < 100 || amount % 100 !== 0) return onNotice("판돈은 100캐시 단위로 입력해줘.");
    if (balance < amount) return onNotice("캐시가 부족해.");
    setRunning(true);
    onBusy(true);
    setResult(null);
    setPositions([0, 0, 0, 0, 0]);
    setRanking([]);
    setSelectedRank(null);
    onNotice("");
    window.dispatchEvent(new CustomEvent("cash-roulette-activity", { detail: { active: true } }));
    try {
      const response = await fetch("/api/cash-horse-race", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-pin": pin },
        body: JSON.stringify({ nickname: nickname.trim(), pick, wager: amount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "경마 게임을 시작하지 못했어.");
      const outcome = data as Result;
      if (!Array.isArray(outcome.order) || outcome.order.length !== 5) throw new Error("경마 결과가 올바르지 않아.");
      const seed = Array.from({ length: 5 }, () => Math.random() * 6.28);
      const began = performance.now();
      const previous = [0, 0, 0, 0, 0];
      let lastPaint = 0;
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const elapsed = now - began;
          if (elapsed - lastPaint > 30 || elapsed >= 11000) {
            lastPaint = elapsed;
            const next = horses.map((_, index) => {
              const place = outcome.order.indexOf(index + 1);
              const duration = 7900 + place * 690;
              const t = Math.min(1, elapsed / duration);
              const wave = Math.sin(elapsed / 460 + seed[index]) * 6 * Math.sin(Math.PI * t);
              previous[index] = Math.min(100, Math.max(previous[index], t * 100 + wave));
              return previous[index];
            });
            const order = horses.map((_, i) => i + 1).sort((a, b) =>
              next[b - 1] - next[a - 1] || outcome.order.indexOf(a) - outcome.order.indexOf(b)
            );
            setPositions([...next]);
            setRanking(order);
            setSelectedRank(order.indexOf(pick) + 1);
          }
          if (elapsed < 11000) frame.current = requestAnimationFrame(tick);
          else resolve();
        };
        frame.current = requestAnimationFrame(tick);
      });
      setPositions([100, 100, 100, 100, 100]);
      setRanking(outcome.order);
      setSelectedRank(outcome.order.indexOf(pick) + 1);
      setResult(outcome);
      await onChanged();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "경마 게임을 처리하지 못했어.");
    } finally {
      setRunning(false);
      onBusy(false);
      window.dispatchEvent(new CustomEvent("cash-roulette-activity", { detail: { active: false } }));
    }
  }

  return (
    <div className={style.panel}>
      <div className={style.top}><span>🏇 경마 게임</span><strong>판돈을 걸고 우승마를 골라줘</strong></div>
      <p className={style.help}>말마다 우승 확률과 총 지급 배수가 달라. 배당에는 건 판돈이 포함돼.</p>
      <div className={style.track}>
        {horses.map((name, index) => (
          <div className={`${style.lane} ${pick === index + 1 ? style.chosen : ""}`} key={name}>
            <span className={style.name}>{index + 1}번 {name}</span>
            <div className={style.course}>
              <span className={style.finish}>FINISH</span>
              <span className={style.horse} style={{ left: `calc(${positions[index]}% - ${positions[index] * 0.38}px)` }} role="img" aria-label={`${index + 1}번 말`}>🐎</span>
            </div>
            <span className={style.place}>{result ? `${result.order.indexOf(index + 1) + 1}등` : running && ranking.length ? `${ranking.indexOf(index + 1) + 1}등` : ""}</span>
          </div>
        ))}
      </div>
      <div className={style.status} aria-live="polite">
        {running ? `내 말 ${pick}번 · 현재 ${selectedRank ?? "출발 대기"}${selectedRank ? "등" : ""}` : result ?
          result.prize ? `🏆 ${pick}번 ${horses[pick - 1]} 우승! ${money(result.prize)} 캐시 지급 · 순이익 ${money(result.prize - result.wager)} 캐시` :
            `내 말은 ${selectedRank}등 · 우승은 ${result.winner}번 ${horses[result.winner - 1]} · ${money(result.wager)} 캐시 차감` :
              "말을 고르고 출발 버튼을 눌러줘"}
      </div>
      {result?.prize ? <div className={style.confetti} aria-hidden="true">🎊 ✨ 🎉 💰 ✨ 🎊</div> : null}
      <div className={style.picks}>
        {horses.map((name, index) => <button key={name} type="button" disabled={running} onClick={() => { setPick(index + 1); setResult(null); }} className={pick === index + 1 ? style.selected : ""}>
          <span>{index + 1}번 {name}</span><small>{chances[index]}% · {odds[index].toFixed(2)}배</small>
        </button>)}
      </div>
      <div className={style.betting}>
        <label htmlFor="horse-wager">판돈 <span>100캐시 단위</span></label>
        <div><input id="horse-wager" type="number" inputMode="numeric" min="100" step="100" value={wager} disabled={running} onChange={(event) => { setWager(event.target.value); setResult(null); }} /><span>캐시</span></div>
        <p>선택한 말 당첨 시 총 <strong>{Number.isSafeInteger(Number(wager)) && Number(wager) > 0 ? money(Math.floor(Number(wager) * multipliers[pick - 1] / 100)) : "—"} 캐시</strong> 지급</p>
      </div>
      <button type="button" disabled={running || balance === null} onClick={() => void start()} className={style.start}>
        {running ? "말들이 달리는 중..." : `경마 시작 · ${money(Number(wager) || 0)} 캐시`}
      </button>
    </div>
  );
}

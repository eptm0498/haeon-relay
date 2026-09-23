"use client";

import { useEffect, useMemo, useState } from "react";
import GamePanel from "./GamePanel";
import RouletteSettings from "./RouletteSettings";
import TimerOverlay from "./TimerOverlay";
import SettingsPanel from "./SettingsPanel";
import RedButtonEvent from "./RedButtonEvent";

type User = {
  id: number;
  nickname: string;
  cash_balance: number;
  total_charged: number;
  total_spent: number;
  title_text?: string | null;
  title_count?: number;
};

type Roulette = { id: number; name: string; cost: number };
type ContentItem = { id: number; name: string; cost: number };
type Keep = { id: number; item_name: string; quantity: number; time_limit_minutes?: number; source_roulette_name?: string | null };
type KeepOption = { label: string; time_limit_minutes: number; roulette_name: string };
type Charge = { id: number; amount: number; note: string | null; created_at: string };
type Bootstrap = { users: User[]; roulettes: Roulette[]; contents: ContentItem[]; discount_percent: number };
type UserDetail = { user: User; keeps: Keep[]; charges: Charge[] };
type SpinResult = {
  ok: boolean;
  spin_id: number;
  label: string;
  result_type: "keep" | "cash" | "cash_loss" | "nothing";
  balance: number;
};

const SPECIAL_CHOICE_KEEP = "원하는 컨텐츠 룰렛 하나 킵";
const money = (v: number) => Number(v || 0).toLocaleString("ko-KR");
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));

export default function CashBoardPage() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<Bootstrap>({ users: [], roulettes: [], contents: [], discount_percent: 0 });
  const [tab, setTab] = useState<"charge" | "roulette" | "users" | "settings">("charge");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const [chargeNick, setChargeNick] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");

  const [rouletteNick, setRouletteNick] = useState("");
  const [rouletteId, setRouletteId] = useState<number | null>(null);
  const [spinResult, setSpinResult] = useState<SpinResult | null>(null);

  const [contentNick, setContentNick] = useState("");
  const [contentId, setContentId] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [keepOptions, setKeepOptions] = useState<KeepOption[]>([]);
  const [restoreKeep, setRestoreKeep] = useState("");
  const [choiceKeep, setChoiceKeep] = useState("");

  async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("/api/cash-board", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "요청을 처리하지 못했어.");
    return result as T;
  }

  async function userApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("/api/cash-board-users", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "사용자 요청을 처리하지 못했어.");
    return result as T;
  }

  async function effectsApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("/api/cash-effects", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "상태 요청을 처리하지 못했어.");
    return result as T;
  }

  async function reload() {
    const next = await api<Bootstrap>("bootstrap");
    setData(next);
    setRouletteId((current) => current ?? next.roulettes[0]?.id ?? null);
    setContentId((current) => current ?? next.contents[0]?.id ?? null);
    return next;
  }

  useEffect(() => {
    if (!authed) return;

    const syncQueueChange = () => {
      void (async () => {
        try {
          const next = await reload();

          if (!selectedUser) return;

          const detail = await userApi<UserDetail>("detail", {
            user_id: selectedUser.user.id,
          });
          const titled = next.users.find(
            (user) => user.id === selectedUser.user.id
          );

          setSelectedUser({
            ...detail,
            user: {
              ...detail.user,
              title_text: titled?.title_text ?? null,
              title_count: titled?.title_count ?? 0,
            },
          });
        } catch {}
      })();
    };

    window.addEventListener("cash-queue-updated", syncQueueChange);

    return () => {
      window.removeEventListener("cash-queue-updated", syncQueueChange);
    };
  }, [authed, pin, selectedUser?.user.id]);

  async function login() {
    if (!pin.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      await reload();
      setAuthed(true);
    } catch {
      setNotice("비밀번호를 확인해줘.");
    } finally {
      setBusy(false);
    }
  }

  async function charge() {
    const amount = Number(chargeAmount);
    if (!chargeNick.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotice("닉네임과 충전 금액을 입력해줘.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ created: boolean; balance: number }>("charge", {
        nickname: chargeNick.trim(),
        amount,
      });
      await reload();
      setNotice(
        result.created
          ? `${chargeNick.trim()} 신규 등록 · ${money(amount)} 캐시 충전 완료`
          : `${chargeNick.trim()} · ${money(amount)} 캐시 충전 완료`
      );
      setChargeNick("");
      setChargeAmount("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "충전에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function spin() {
    if (!rouletteNick.trim() || !rouletteId) {
      setNotice("닉네임과 룰렛을 선택해줘.");
      return;
    }
    setBusy(true);
    setNotice("");
    setSpinResult(null);
    try {
      const result = await api<SpinResult>("spin", {
        nickname: rouletteNick.trim(),
        roulette_id: rouletteId,
      });
      setSpinResult(result);
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "룰렛 실행에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveSpin(mode: "use" | "keep") {
    if (!spinResult) return;
    setBusy(true);
    setNotice("");
    try {
      await api("resolve_spin", { spin_id: spinResult.spin_id, mode });
      setNotice(mode === "keep" ? `${spinResult.label} 킵 저장 완료` : `${spinResult.label} 즉시사용 완료`);
      setSpinResult(null);
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "결과 처리에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function useContent() {
    if (!contentNick.trim() || !contentId) {
      setNotice("닉네임과 콘텐츠를 선택해줘.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await api("use_content", { nickname: contentNick.trim(), content_id: contentId });
      await reload();
      setNotice("콘텐츠 사용 완료");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "콘텐츠 사용에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function openUser(id: number) {
    setBusy(true);
    setNotice("");
    try {
      const [detail, optionData] = await Promise.all([
        userApi<UserDetail>("detail", { user_id: id }),
        effectsApi<{ options: KeepOption[] }>("options"),
      ]);
      const fromList = data.users.find((user) => user.id === id);
      setSelectedUser({
        ...detail,
        user: {
          ...detail.user,
          title_text: fromList?.title_text ?? null,
          title_count: fromList?.title_count ?? 0,
        },
      });
      setKeepOptions(optionData.options || []);
      setRestoreKeep("");
      setChoiceKeep("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "사용자 정보를 불러오지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  async function useKeep(itemName: string) {
    if (!selectedUser) return;

    let speechSuffix: string | undefined;
    if (itemName.includes("00체")) {
      const entered = window.prompt("무슨 체로 할까? 예: 냥  ·  해제하려면 '해제'");
      if (entered === null) return;
      speechSuffix = entered.trim();
      if (!speechSuffix) {
        setNotice("무슨 체인지 입력해줘.");
        return;
      }
    }

    setBusy(true);
    setNotice("");
    try {
      if (itemName.includes("00체") || itemName.includes("아봉") || itemName === "금연") {
        const effect = await effectsApi<{
          kind: string;
          active: boolean;
          queued?: boolean;
          label: string;
        }>("use_special", {
          user_id: selectedUser.user.id,
          item_name: itemName,
          speech_suffix: speechSuffix,
        });

        if (effect.kind === "speech_style") {
          setNotice(
            effect.queued
              ? `${effect.label}을(를) 다음 말투 대기열에 넣었어.`
              : effect.active
                ? `${effect.label} 10분 시작`
                : "말투 제한을 해제했어."
          );
        } else if (effect.kind === "smoking") {
          setNotice("금연 상태를 시작했어.");
        } else {
          setNotice(effect.active ? "현재 아봉중" : "아봉을 해제했어.");
        }

        window.dispatchEvent(new Event("cash-effect-updated"));
      } else {
        await api("use_keep", { user_id: selectedUser.user.id, item_name: itemName });
        setNotice(`${itemName} 1회 사용 완료`);
      }

      window.dispatchEvent(new Event("cash-timer-updated"));
      const detail = await userApi<UserDetail>("detail", { user_id: selectedUser.user.id });
      const next = await reload();
      const titled = next.users.find((user) => user.id === selectedUser.user.id);
      setSelectedUser({
        ...detail,
        user: {
          ...detail.user,
          title_text: titled?.title_text ?? null,
          title_count: titled?.title_count ?? 0,
        },
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "킵 사용에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreKeepToUser() {
    if (!selectedUser || !restoreKeep) {
      setNotice("다시 넣을 킵을 선택해줘.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      await effectsApi("add_keep", {
        user_id: selectedUser.user.id,
        item_name: restoreKeep,
      });
      const detail = await userApi<UserDetail>("detail", { user_id: selectedUser.user.id });
      const next = await reload();
      const titled = next.users.find((user) => user.id === selectedUser.user.id);
      setSelectedUser({
        ...detail,
        user: {
          ...detail.user,
          title_text: titled?.title_text ?? null,
          title_count: titled?.title_count ?? 0,
        },
      });
      setNotice(`${restoreKeep} 킵을 1개 다시 넣었어.`);
      setRestoreKeep("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "킵을 다시 넣지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  async function redeemChoiceKeep() {
    if (!selectedUser || !choiceKeep) {
      setNotice("지급할 콘텐츠 룰렛 킵을 선택해줘.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      await api("redeem_choice_keep", {
        user_id: selectedUser.user.id,
        item_name: choiceKeep,
      });
      const detail = await userApi<UserDetail>("detail", {
        user_id: selectedUser.user.id,
      });
      const next = await reload();
      const titled = next.users.find(
        (user) => user.id === selectedUser.user.id
      );
      setSelectedUser({
        ...detail,
        user: {
          ...detail.user,
          title_text: titled?.title_text ?? null,
          title_count: titled?.title_count ?? 0,
        },
      });
      setNotice(`${choiceKeep} 킵을 선택해서 지급했어.`);
      setChoiceKeep("");
      window.dispatchEvent(new Event("cash-queue-updated"));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "특수 선택권 지급에 실패했어."
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (!selectedUser) return;

    const nickname = selectedUser.user.nickname;
    const confirmed = window.confirm(
      `'${nickname}' 사용자를 정말 삭제할까?\n보유 캐시, 킵, 후원/사용 이력이 모두 삭제돼.`
    );
    if (!confirmed) return;

    setBusy(true);
    setNotice("");
    try {
      await userApi("delete", { user_id: selectedUser.user.id });
      setSelectedUser(null);
      setSearch("");
      await reload();
      setNotice(`${nickname} 사용자를 삭제했어.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "사용자 삭제에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.users
      .filter((user) => !q || user.nickname.toLowerCase().includes(q))
      .slice(0, 50);
  }, [data.users, search]);

  function suggestions(value: string) {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    if (data.users.some((user) => user.nickname.toLowerCase() === q)) return [];
    return data.users
      .filter((user) => user.nickname.toLowerCase().includes(q))
      .slice(0, 6);
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-[#f6f7f9] px-4 py-10 text-[#111318]">
        <div className="mx-auto max-w-md">
          <div className="mb-5">
            <h1 className="text-2xl font-extrabold tracking-tight">온유의 캐시 보드</h1>
            <p className="mt-1 text-sm text-zinc-500">관리자 전용</p>
          </div>
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <label className="text-sm font-bold">관리자 비밀번호</label>
            <div className="mt-3 flex gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                inputMode="numeric"
                type="password"
                placeholder="4자리 비밀번호"
                className="min-w-0 flex-1 rounded-2xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500"
              />
              <button
                onClick={login}
                disabled={busy}
                className="rounded-2xl bg-zinc-950 px-5 py-3 font-bold text-white disabled:opacity-40"
              >
                입장
              </button>
            </div>
            {notice && <p className="mt-3 text-sm font-semibold text-red-500">{notice}</p>}
          </div>
        </div>
      </main>
    );
  }

  const tabs = [
    ["charge", "충전"],
    ["roulette", "게임"],
    ["users", "시청자"],
    ["settings", "설정"],
  ] as const;

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-3 py-5 text-[#111318] sm:px-5">
      <div className="mx-auto max-w-[640px]">
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">온유의 캐시 보드</h1>
          </div>
          <button
            onClick={() => {
              setAuthed(false);
              setPin("");
              setSelectedUser(null);
            }}
            className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-zinc-500 ring-1 ring-zinc-200"
          >
            나가기
          </button>
        </header>

        <nav className="mb-4 grid grid-cols-4 gap-2">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setNotice("");
              }}
              className={
                "rounded-2xl px-2 py-3 text-sm font-extrabold transition " +
                (tab === key ? "bg-zinc-950 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200")
              }
            >
              {label}
            </button>
          ))}
        </nav>

        {notice && (
          <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold">
            {notice}
          </div>
        )}

        {tab === "charge" && (
          <Card title="캐시 충전" subtitle="기존 닉네임을 선택하거나 새 닉네임을 입력해.">
            <NameInput
              value={chargeNick}
              onChange={setChargeNick}
              users={suggestions(chargeNick)}
              onPick={setChargeNick}
            />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[1000, 5000, 10000, 30000].map((amount) => (
                <button
                  key={amount}
                  onClick={() => setChargeAmount(String(amount))}
                  className="rounded-2xl bg-emerald-50 px-2 py-3 text-sm font-extrabold text-emerald-700"
                >
                  +{money(amount)}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                inputMode="numeric"
                type="number"
                placeholder="충전 금액"
                className="min-w-0 flex-1 rounded-2xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500"
              />
              <button
                onClick={charge}
                disabled={busy}
                className="rounded-2xl bg-zinc-950 px-5 py-3 font-extrabold text-white disabled:opacity-40"
              >
                충전
              </button>
            </div>
          </Card>
        )}

        {tab === "roulette" && (
          <GamePanel
            pin={pin}
            users={data.users}
            roulettes={data.roulettes}
            onChanged={reload}
            onNotice={setNotice}
            discountPercent={data.discount_percent}
          />
        )}

        {tab === "users" && (
          <>
            <Card title="사용자 검색" subtitle="보유 캐시와 킵을 한 번에 확인해.">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="닉네임 검색"
                className="w-full rounded-2xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500"
              />
              <div className="mt-3 space-y-2">
                {filteredUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => openUser(user.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="font-extrabold">{user.nickname}</span>
                      {user.title_text && (
                        <span className="ml-2 inline-flex rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-600">
                          {user.title_text}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-black">{money(user.cash_balance)} 캐시</span>
                  </button>
                ))}
              </div>
            </Card>

            {selectedUser && (
              <div className="mt-3 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-lg font-black">{selectedUser.user.nickname}</div>
                      {selectedUser.user.title_text && (
                        <div className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-600">
                          {selectedUser.user.title_text}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-zinc-500">보유 캐시</div>
                  </div>
                  <div className="shrink-0 text-3xl font-black">{money(selectedUser.user.cash_balance)}</div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <Stat label="누적 충전" value={money(selectedUser.user.total_charged)} />
                  <Stat label="누적 사용" value={money(selectedUser.user.total_spent)} />
                </div>

                <div className="mt-6">
                  <div className="mb-2 text-sm font-extrabold text-zinc-500">보유 킵</div>
                  {selectedUser.keeps.length === 0 ? (
                    <div className="rounded-2xl bg-zinc-50 px-4 py-4 text-sm font-semibold text-zinc-400">
                      보유한 킵이 없어.
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100">
                      {selectedUser.keeps.map((keep) => (
                        <div key={keep.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <div className="font-extrabold">
                              {keep.item_name} <span className="text-zinc-400">×{keep.quantity}</span>
                            </div>
                            {keep.item_name.includes("00체") ? (
                              <div className="mt-1 inline-flex rounded-full bg-fuchsia-50 px-2 py-1 text-[10px] font-black text-fuchsia-700">
                                말투 입력 후 10분
                              </div>
                            ) : keep.item_name.includes("아봉") ? (
                              <div className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">
                                다른 사용자의 아봉까지 유지
                              </div>
                            ) : Number(keep.time_limit_minutes || 0) > 0 ? (
                              <div className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                                ⏱ 사용 시 {keep.time_limit_minutes}분
                              </div>
                            ) : null}
                          </div>
                          {keep.item_name === SPECIAL_CHOICE_KEEP ? (
                            <span className="rounded-xl bg-fuchsia-50 px-3 py-2 text-xs font-black text-fuchsia-700">
                              선택권
                            </span>
                          ) : (
                            <button
                              onClick={() => useKeep(keep.item_name)}
                              disabled={busy}
                              className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-extrabold text-blue-700 disabled:opacity-40"
                            >
                              사용
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedUser.keeps.some(
                    (keep) =>
                      keep.item_name === SPECIAL_CHOICE_KEEP &&
                      Number(keep.quantity || 0) > 0
                  ) && (
                    <div className="mt-3 rounded-2xl bg-fuchsia-50 p-3 ring-1 ring-fuchsia-100">
                      <div className="text-[11px] font-black text-fuchsia-700">
                        특수 선택권으로 원하는 콘텐츠 룰렛 킵 지급
                      </div>
                      <div className="mt-1 text-[10px] font-bold text-fuchsia-500">
                        온유가 아래에서 하나를 골라 수동으로 넣어줘.
                      </div>
                      <div className="mt-2 flex gap-2">
                        <select
                          value={choiceKeep}
                          onChange={(e) => setChoiceKeep(e.target.value)}
                          className="min-w-0 flex-1 rounded-xl border border-fuchsia-100 bg-white px-3 py-2.5 text-xs font-bold outline-none"
                        >
                          <option value="">콘텐츠 룰렛 항목 선택</option>
                          {keepOptions
                            .filter(
                              (option) =>
                                option.roulette_name === "콘텐츠 룰렛"
                            )
                            .map((option) => (
                              <option key={option.label} value={option.label}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={redeemChoiceKeep}
                          disabled={busy || !choiceKeep}
                          className="shrink-0 rounded-xl bg-fuchsia-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-40"
                        >
                          선택 지급
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 rounded-2xl bg-violet-50 p-3 ring-1 ring-violet-100">
                    <div className="mb-2 text-[11px] font-black text-violet-700">킵 다시 넣기</div>
                    <div className="flex gap-2">
                      <select
                        value={restoreKeep}
                        onChange={(e) => setRestoreKeep(e.target.value)}
                        className="min-w-0 flex-1 rounded-xl border border-violet-100 bg-white px-3 py-2.5 text-xs font-bold outline-none"
                      >
                        <option value="">룰렛 항목 선택</option>
                        {keepOptions.map((option) => (
                          <option key={option.label} value={option.label}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={restoreKeepToUser}
                        disabled={busy || !restoreKeep}
                        className="shrink-0 rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-40"
                      >
                        +1 넣기
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-extrabold text-zinc-500">후원 이력</div>
                    <div className="text-[11px] font-bold text-zinc-400">최근 50건까지 · 현재 {selectedUser.charges.length}건</div>
                  </div>
                  {selectedUser.charges.length === 0 ? (
                    <div className="rounded-2xl bg-zinc-50 px-4 py-4 text-sm font-semibold text-zinc-400">
                      후원 충전 기록이 없어.
                    </div>
                  ) : (
                    <div className="max-h-[280px] divide-y divide-zinc-100 overflow-auto rounded-2xl border border-zinc-100 bg-zinc-50 px-3">
                      {selectedUser.charges.map((charge) => (
                        <div key={charge.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black text-zinc-800">
                              +{money(charge.amount)} 캐시
                            </div>
                            <div className="mt-0.5 text-[11px] font-bold text-zinc-400">
                              {dateTime(charge.created_at)}
                            </div>
                          </div>
                          <div className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                            후원
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-6 border-t border-zinc-100 pt-4">
                  <button
                    type="button"
                    onClick={deleteUser}
                    disabled={busy}
                    className="w-full rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-600 ring-1 ring-rose-100 disabled:opacity-40"
                  >
                    사용자 삭제
                  </button>
                  <div className="mt-2 text-center text-[10px] font-bold text-zinc-400">
                    삭제하면 이 사용자의 캐시·킵·거래 이력이 함께 삭제돼.
                  </div>
                </div>
              </div>
            )}

          </>
        )}

        {tab === "settings" && (
          <div className="space-y-3">
            <RouletteSettings
              pin={pin}
              onSaved={reload}
              onNotice={setNotice}
            />
            <SettingsPanel
              pin={pin}
              onNotice={setNotice}
              onChanged={reload}
            />
          </div>
        )}

      </div>
      <RedButtonEvent
        pin={pin}
        users={data.users}
        onChanged={reload}
        onNotice={setNotice}
      />
      <TimerOverlay pin={pin} />
    </main>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function NameInput({
  value,
  onChange,
  users,
  onPick,
}: {
  value: string;
  onChange: (value: string) => void;
  users: User[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="닉네임"
        onKeyDown={(e) => {
          if (e.key === "Enter" && users[0]) {
            e.preventDefault();
            onPick(users[0].nickname);
          }
        }}
        className="w-full rounded-2xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500"
      />
      {users.length > 0 && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => onPick(user.nickname)}
              className="flex w-full items-center justify-between border-b border-zinc-100 px-4 py-3 text-left last:border-0 hover:bg-zinc-50"
            >
              <span className="font-bold">{user.nickname}</span>
              <span className="text-sm font-extrabold text-zinc-500">{money(user.cash_balance)} 캐시</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-zinc-50 px-3 py-3">
      <div className="text-xs font-bold text-zinc-400">{label}</div>
      <div className="mt-1 font-black">{value}</div>
    </div>
  );
}

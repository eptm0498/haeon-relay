"use client";

import { useMemo, useState } from "react";

type User = {
  id: number;
  nickname: string;
  cash_balance: number;
  total_charged: number;
  total_spent: number;
};

type Roulette = { id: number; name: string; cost: number };
type ContentItem = { id: number; name: string; cost: number };
type Keep = { id: number; item_name: string; quantity: number };
type Bootstrap = { users: User[]; roulettes: Roulette[]; contents: ContentItem[] };
type UserDetail = { user: User; keeps: Keep[] };
type SpinResult = {
  ok: boolean;
  spin_id: number;
  label: string;
  result_type: "keep" | "cash" | "nothing";
  balance: number;
};

const money = (v: number) => Number(v || 0).toLocaleString("ko-KR");

export default function CashBoardPage() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<Bootstrap>({ users: [], roulettes: [], contents: [] });
  const [tab, setTab] = useState<"charge" | "roulette" | "content" | "users">("charge");
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

  async function reload() {
    const next = await api<Bootstrap>("bootstrap");
    setData(next);
    setRouletteId((current) => current ?? next.roulettes[0]?.id ?? null);
    setContentId((current) => current ?? next.contents[0]?.id ?? null);
    return next;
  }

  async function login() {
    if (!pin.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      await reload();
      setAuthed(true);
    } catch {
      setNotice("PIN을 확인해줘.");
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
          ? `${chargeNick.trim()} 신규 등록 · ${money(amount)} CASH 충전 완료`
          : `${chargeNick.trim()} · ${money(amount)} CASH 충전 완료`
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
      const detail = await api<UserDetail>("user_detail", { user_id: id });
      setSelectedUser(detail);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "사용자 정보를 불러오지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  async function useKeep(itemName: string) {
    if (!selectedUser) return;
    setBusy(true);
    setNotice("");
    try {
      await api("use_keep", { user_id: selectedUser.user.id, item_name: itemName });
      const detail = await api<UserDetail>("user_detail", { user_id: selectedUser.user.id });
      setSelectedUser(detail);
      await reload();
      setNotice(`${itemName} 1회 사용 완료`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "킵 사용에 실패했어.");
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
            <h1 className="text-2xl font-extrabold tracking-tight">CASH BOARD</h1>
            <p className="mt-1 text-sm text-zinc-500">관리자 전용</p>
          </div>
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <label className="text-sm font-bold">관리자 PIN</label>
            <div className="mt-3 flex gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()}
                inputMode="numeric"
                type="password"
                placeholder="4자리 PIN"
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
    ["charge", "+ 충전"],
    ["roulette", "게임"],
    ["content", "바로쓰기"],
    ["users", "사용자"],
  ] as const;

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-3 py-5 text-[#111318] sm:px-5">
      <div className="mx-auto max-w-[640px]">
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">CASH BOARD</h1>
            <p className="mt-1 text-sm text-zinc-500">충전 · 게임 · 바로쓰기 · 킵</p>
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
          <Card title="게임" subtitle="캐시를 쓰고 랜덤 결과를 확인해.">
            <NameInput
              value={rouletteNick}
              onChange={setRouletteNick}
              users={suggestions(rouletteNick)}
              onPick={setRouletteNick}
            />
            <select
              value={rouletteId ?? ""}
              onChange={(e) => setRouletteId(Number(e.target.value))}
              className="mt-3 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 outline-none"
            >
              {data.roulettes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {money(item.cost)} CASH
                </option>
              ))}
            </select>
            <button
              onClick={spin}
              disabled={busy}
              className="mt-3 w-full rounded-2xl bg-zinc-950 px-4 py-4 font-extrabold text-white disabled:opacity-40"
            >
              룰렛 실행
            </button>

            {spinResult && (
              <div className="mt-4 rounded-3xl bg-zinc-50 p-5 text-center ring-1 ring-zinc-200">
                <div className="text-sm font-bold text-zinc-500">결과</div>
                <div className="mt-2 text-3xl font-black">{spinResult.label}</div>
                {spinResult.result_type === "keep" && (
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => resolveSpin("use")}
                      disabled={busy}
                      className="rounded-2xl bg-blue-50 px-4 py-3 font-extrabold text-blue-700 disabled:opacity-40"
                    >
                      즉시사용
                    </button>
                    <button
                      onClick={() => resolveSpin("keep")}
                      disabled={busy}
                      className="rounded-2xl bg-violet-50 px-4 py-3 font-extrabold text-violet-700 disabled:opacity-40"
                    >
                      킵
                    </button>
                  </div>
                )}
                {spinResult.result_type === "cash" && (
                  <p className="mt-3 text-sm font-semibold text-zinc-500">캐시에 자동 반영됐어.</p>
                )}
              </div>
            )}
          </Card>
        )}

        {tab === "content" && (
          <Card title="바로쓰기" subtitle="랜덤 없이 원하는 콘텐츠를 확정으로 사용해.">
            <NameInput
              value={contentNick}
              onChange={setContentNick}
              users={suggestions(contentNick)}
              onPick={setContentNick}
            />
            <select
              value={contentId ?? ""}
              onChange={(e) => setContentId(Number(e.target.value))}
              className="mt-3 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 outline-none"
            >
              {data.contents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {money(item.cost)} CASH
                </option>
              ))}
            </select>
            <button
              onClick={useContent}
              disabled={busy}
              className="mt-3 w-full rounded-2xl bg-zinc-950 px-4 py-4 font-extrabold text-white disabled:opacity-40"
            >
              콘텐츠 사용
            </button>
          </Card>
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
                    <span className="font-extrabold">{user.nickname}</span>
                    <span className="font-black">{money(user.cash_balance)} CASH</span>
                  </button>
                ))}
              </div>
            </Card>

            {selectedUser && (
              <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-lg font-black">{selectedUser.user.nickname}</div>
                    <div className="mt-1 text-sm text-zinc-500">보유 CASH</div>
                  </div>
                  <div className="text-3xl font-black">{money(selectedUser.user.cash_balance)}</div>
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
                          <div className="font-extrabold">
                            {keep.item_name} <span className="text-zinc-400">×{keep.quantity}</span>
                          </div>
                          <button
                            onClick={() => useKeep(keep.item_name)}
                            disabled={busy}
                            className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-extrabold text-blue-700 disabled:opacity-40"
                          >
                            사용
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
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
              <span className="text-sm font-extrabold text-zinc-500">{money(user.cash_balance)} CASH</span>
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

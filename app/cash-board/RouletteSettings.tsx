"use client";

import { useEffect, useMemo, useState } from "react";

type ResultType = "keep" | "cash" | "nothing";
type RouletteItem = {
  id?: number;
  label: string;
  result_type: ResultType;
  cash_amount: number;
  weight: number;
  sort_order?: number;
};
type RouletteConfig = {
  id: number;
  name: string;
  cost: number;
  active: boolean;
  sort_order: number;
  items: RouletteItem[];
};

async function post<T>(pin: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/cash-board-settings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-pin": pin },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "룰렛 설정을 처리하지 못했어.");
  return data as T;
}

export default function RouletteSettings({
  pin,
  onSaved,
  onNotice,
}: {
  pin: string;
  onSaved: () => Promise<unknown>;
  onNotice: (message: string) => void;
}) {
  const [list, setList] = useState<RouletteConfig[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RouletteConfig | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(preferId?: number) {
    const data = await post<{ roulettes: RouletteConfig[] }>(pin, { action: "list" });
    setList(data.roulettes);
    const requestedId = preferId ?? selectedId;
    const found = data.roulettes.find((item) => item.id === requestedId) ?? data.roulettes[0] ?? null;
    setSelectedId(found?.id ?? null);
    setDraft(found ? structuredClone(found) : null);
  }

  useEffect(() => {
    void load();
  }, [pin]);

  const total = useMemo(
    () => draft?.items.reduce((sum, item) => sum + Number(item.weight || 0), 0) ?? 0,
    [draft]
  );

  function selectRoulette(id: number) {
    setSelectedId(id);
    const found = list.find((item) => item.id === id);
    setDraft(found ? structuredClone(found) : null);
    onNotice("");
  }

  function updateItem(index: number, patch: Partial<RouletteItem>) {
    setDraft((current) => {
      if (!current) return current;
      const items = current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      );
      return { ...current, items };
    });
  }

  function addItem() {
    setDraft((current) => {
      if (!current || current.items.length >= 12) return current;
      const items = current.items.map((item) => ({ ...item }));
      let probability = 10;

      if (items.length === 0) {
        probability = 100;
      } else {
        const largestIndex = items.reduce(
          (best, item, index, all) => (item.weight > all[best].weight ? index : best),
          0
        );
        if (items[largestIndex].weight > 10) {
          items[largestIndex].weight -= 10;
        } else {
          probability = 1;
        }
      }

      items.push({
        label: "새 항목",
        result_type: "keep",
        cash_amount: 0,
        weight: probability,
      });

      return { ...current, items };
    });
  }

  function removeItem(index: number) {
    setDraft((current) => {
      if (!current || current.items.length <= 2) return current;
      const removed = current.items[index];
      const items = current.items.filter((_, itemIndex) => itemIndex !== index).map((item) => ({ ...item }));
      if (items[0]) items[0].weight += Number(removed.weight || 0);
      return { ...current, items };
    });
  }

  async function createRoulette() {
    setBusy(true);
    onNotice("");
    try {
      const data = await post<{ roulette_id: number }>(pin, { action: "create" });
      await load(data.roulette_id);
      await onSaved();
      onNotice("새 룰렛을 만들었어.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "새 룰렛 생성에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRoulette() {
    if (!draft) return;
    const confirmed = window.confirm(`'${draft.name}' 룰렛을 정말 삭제할까?\n삭제하면 되돌릴 수 없어.`);
    if (!confirmed) return;

    setBusy(true);
    onNotice("");
    try {
      const response = await fetch("/api/cash-board-delete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-pin": pin },
        body: JSON.stringify({ id: draft.id }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "룰렛 삭제에 실패했어.");

      setSelectedId(null);
      setDraft(null);
      await load();
      await onSaved();
      onNotice(`${data.deleted_name || "룰렛"}을 삭제했어.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "룰렛 삭제에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRoulette() {
    if (!draft) return;
    if (total !== 100) {
      onNotice("확률 합계를 100%로 맞춰줘.");
      return;
    }

    setBusy(true);
    onNotice("");
    try {
      await post(pin, {
        action: "save",
        id: draft.id,
        name: draft.name,
        cost: Number(draft.cost),
        active: draft.active,
        items: draft.items.map((item) => ({
          label: item.label,
          result_type: item.result_type,
          cash_amount: item.result_type === "cash" ? Number(item.cash_amount || 0) : 0,
          weight: Number(item.weight),
        })),
      });
      await load(draft.id);
      await onSaved();
      onNotice("룰렛 설정을 저장했어.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "룰렛 저장에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[26px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(30,20,60,.08)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-black tracking-[.2em] text-violet-500">룰렛 관리</div>
          <h2 className="mt-1 text-lg font-black">룰렛 설정</h2>
          <p className="mt-0.5 text-xs font-medium text-zinc-400">룰렛 가격과 결과 확률을 방송 중에도 바로 바꿀 수 있어.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={createRoulette}
            disabled={busy}
            className="rounded-xl bg-zinc-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
          >
            + 새 룰렛
          </button>
          <button
            type="button"
            onClick={deleteRoulette}
            disabled={busy || !draft || list.length <= 1}
            className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 ring-1 ring-rose-100 disabled:opacity-35"
          >
            룰렛 삭제
          </button>
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {list.map((roulette) => (
          <button
            key={roulette.id}
            type="button"
            onClick={() => selectRoulette(roulette.id)}
            className={
              "shrink-0 rounded-xl px-3 py-2 text-xs font-black ring-1 transition " +
              (selectedId === roulette.id
                ? "bg-violet-600 text-white ring-violet-600"
                : "bg-white text-zinc-500 ring-zinc-200")
            }
          >
            {roulette.name}
            {!roulette.active && <span className="ml-1 opacity-60">꺼짐</span>}
          </button>
        ))}
      </div>

      {draft && (
        <div className="mt-3">
          <div className="grid grid-cols-[1fr_130px] gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-black text-zinc-400">룰렛 이름</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-violet-300 focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black text-zinc-400">1회 사용 캐시</span>
              <input
                value={draft.cost}
                onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value || 0) })}
                inputMode="numeric"
                type="number"
                min={0}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-violet-300 focus:bg-white"
              />
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2.5">
            <div className="text-xs font-black text-zinc-500">
              확률 합계
              <span className={"ml-2 text-sm " + (total === 100 ? "text-emerald-600" : "text-rose-500")}>
                {total}%
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, active: !draft.active })}
              className={
                "rounded-full px-3 py-1.5 text-[10px] font-black " +
                (draft.active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-500")
              }
            >
              {draft.active ? "사용 중" : "사용 안 함"}
            </button>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
            <div
              className={"h-full transition-all " + (total === 100 ? "bg-emerald-500" : "bg-rose-400")}
              style={{ width: Math.min(100, total) + "%" }}
            />
          </div>

          <div className="mt-3 space-y-2">
            {draft.items.map((item, index) => (
              <div key={item.id ?? index} className="rounded-2xl border border-zinc-200 bg-white p-3">
                <div className="grid grid-cols-[1fr_92px_74px] gap-2">
                  <input
                    value={item.label}
                    onChange={(e) => updateItem(index, { label: e.target.value })}
                    placeholder="결과 이름"
                    className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-bold outline-none focus:border-violet-300 focus:bg-white"
                  />
                  <select
                    value={item.result_type}
                    onChange={(e) => updateItem(index, { result_type: e.target.value as ResultType })}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs font-black outline-none"
                  >
                    <option value="keep">킵</option>
                    <option value="cash">캐시</option>
                    <option value="nothing">꽝</option>
                  </select>
                  <div className="relative">
                    <input
                      value={item.weight}
                      onChange={(e) => updateItem(index, { weight: Number(e.target.value || 0) })}
                      inputMode="numeric"
                      type="number"
                      min={1}
                      max={100}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 pr-6 text-right text-xs font-black outline-none focus:border-violet-300"
                    />
                    <span className="pointer-events-none absolute right-2 top-2 text-xs font-black text-zinc-400">%</span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  {item.result_type === "cash" ? (
                    <input
                      value={item.cash_amount}
                      onChange={(e) => updateItem(index, { cash_amount: Number(e.target.value || 0) })}
                      inputMode="numeric"
                      type="number"
                      min={0}
                      placeholder="당첨 캐시"
                      className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-bold outline-none focus:border-violet-300"
                    />
                  ) : (
                    <div className="flex-1 text-[10px] font-bold text-zinc-400">
                      {item.result_type === "keep" ? "당첨 시 즉시사용 / 킵 선택" : "당첨 보상 없음"}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    disabled={draft.items.length <= 2}
                    className="rounded-xl bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-500 disabled:opacity-30"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={addItem}
              disabled={draft.items.length >= 12}
              className="rounded-2xl bg-zinc-100 px-4 py-3 text-xs font-black text-zinc-600 disabled:opacity-40"
            >
              + 결과 항목 추가
            </button>
            <button
              type="button"
              onClick={saveRoulette}
              disabled={busy || total !== 100}
              className="rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-3 text-xs font-black text-white shadow-lg shadow-violet-200/60 disabled:opacity-40"
            >
              설정 저장
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

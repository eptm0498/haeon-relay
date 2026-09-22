"use client";

import { useEffect, useState } from "react";

type QueueItem = {
  id: number;
  nickname: string;
  item_name: string;
  created_at: string;
};

type TimelineItem = {
  id: number;
  nickname: string;
  kind: string;
  label: string;
  detail: string;
  created_at: string;
};

type SettingsData = {
  discount_percent: number;
  queue: QueueItem[];
  timeline: TimelineItem[];
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

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
  if (!response.ok) throw new Error(data?.error || "설정을 처리하지 못했어.");
  return data as T;
}

export default function SettingsPanel({
  pin,
  onNotice,
  onChanged,
}: {
  pin: string;
  onNotice: (message: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [data, setData] = useState<SettingsData>({
    discount_percent: 0,
    queue: [],
    timeline: [],
  });
  const [discount, setDiscount] = useState(0);
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await post<SettingsData & { ok: boolean }>(pin, {
      action: "admin_settings_load",
    });
    setData(next);
    setDiscount(Number(next.discount_percent || 0));
  }

  useEffect(() => {
    void load().catch(() => {});
  }, [pin]);

  async function saveDiscount() {
    setBusy(true);
    onNotice("");
    try {
      const value = Math.max(0, Math.min(90, Math.round(Number(discount || 0))));
      await post(pin, {
        action: "admin_set_discount",
        discount_percent: value,
      });
      await Promise.all([load(), onChanged()]);
      onNotice(value > 0 ? `현재 할인율을 ${value}%로 설정했어.` : "할인을 해제했어.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "할인율 저장에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  async function completeQueue(id: number) {
    setBusy(true);
    onNotice("");
    try {
      await post(pin, { action: "admin_complete_queue", id });
      await load();
      window.dispatchEvent(new Event("cash-queue-updated"));
      onNotice("대기 항목을 완료 처리했어.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "완료 처리에 실패했어.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-lg font-black">현재 할인율</div>
        <div className="mt-1 text-xs font-bold text-zinc-400">
          저장하는 순간부터 모든 룰렛 사용 캐시에 적용돼.
        </div>

        <div className="mt-4 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type="number"
              min={0}
              max={90}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value || 0))}
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-10 text-lg font-black outline-none focus:border-violet-300"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black text-zinc-400">
              %
            </span>
          </div>
          <button
            type="button"
            onClick={saveDiscount}
            disabled={busy}
            className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            저장
          </button>
        </div>

        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {[0, 10, 20, 30, 50].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDiscount(value)}
              className={
                "rounded-xl px-2 py-2 text-xs font-black " +
                (discount === value
                  ? "bg-violet-600 text-white"
                  : "bg-violet-50 text-violet-600")
              }
            >
              {value}%
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black">대기열 관리</div>
            <div className="mt-1 text-xs font-bold text-zinc-400">
              사용됐지만 아직 방송에서 처리하지 않은 항목
            </div>
          </div>
          <div className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-600">
            {data.queue.length}개
          </div>
        </div>

        {data.queue.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-4 text-sm font-bold text-zinc-400">
            현재 대기 중인 항목이 없어.
          </div>
        ) : (
          <div className="mt-3 divide-y divide-zinc-100">
            {data.queue.map((item, index) => (
              <div key={item.id} className="flex items-center gap-3 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-black text-zinc-500">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">
                    {item.nickname} · {item.item_name}
                  </div>
                  <div className="mt-0.5 text-[10px] font-bold text-zinc-400">
                    {dateTime(item.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => completeQueue(item.id)}
                  disabled={busy}
                  className="shrink-0 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:opacity-40"
                >
                  완료
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black">최근 사용 50개</div>
            <div className="mt-1 text-xs font-bold text-zinc-400">
              킵으로 보관만 한 결과는 제외해.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-black text-zinc-600"
          >
            새로고침
          </button>
        </div>

        {data.timeline.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-zinc-50 px-4 py-4 text-sm font-bold text-zinc-400">
            사용 기록이 없어.
          </div>
        ) : (
          <div className="mt-3 max-h-[520px] divide-y divide-zinc-100 overflow-auto">
            {data.timeline.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="flex gap-3 py-3">
                <div
                  className={
                    "mt-0.5 h-fit shrink-0 rounded-full px-2 py-1 text-[9px] font-black " +
                    (item.kind === "룰렛"
                      ? "bg-fuchsia-50 text-fuchsia-600"
                      : "bg-blue-50 text-blue-600")
                  }
                >
                  {item.kind}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black">
                    {item.nickname} · {item.label}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] font-bold text-zinc-400">
                    {item.detail}
                  </div>
                </div>
                <div className="shrink-0 text-[10px] font-bold text-zinc-400">
                  {dateTime(item.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

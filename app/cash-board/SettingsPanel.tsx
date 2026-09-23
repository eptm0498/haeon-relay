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

type EventSettings = {
  golden_ticket_percent: number;
  red_button_per_hour: number;
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

async function postEvent<T>(
  pin: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/cash-event-settings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-pin": pin,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "이벤트 설정을 처리하지 못했어.");
  }
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
  const [goldenTicketPercent, setGoldenTicketPercent] = useState(100);
  const [redButtonPerHour, setRedButtonPerHour] = useState(12);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [next, eventSettings] = await Promise.all([
      post<SettingsData & { ok: boolean }>(pin, {
        action: "admin_settings_load",
      }),
      postEvent<EventSettings & { ok: boolean }>(pin, {
        action: "load",
      }),
    ]);
    setData(next);
    setDiscount(Number(next.discount_percent || 0));
    setGoldenTicketPercent(
      Math.max(0, Math.min(100, Number(eventSettings.golden_ticket_percent ?? 5)))
    );
    setRedButtonPerHour(
      Math.max(0, Math.min(60, Number(eventSettings.red_button_per_hour ?? 2)))
    );
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

  async function saveEventSettings() {
    setBusy(true);
    onNotice("");
    try {
      const golden = Math.max(
        0,
        Math.min(100, Math.round(Number(goldenTicketPercent || 0)))
      );
      const red = Math.max(
        0,
        Math.min(60, Math.round(Number(redButtonPerHour || 0)))
      );

      await postEvent<EventSettings & { ok: boolean }>(pin, {
        action: "save",
        golden_ticket_percent: golden,
        red_button_per_hour: red,
      });

      setGoldenTicketPercent(golden);
      setRedButtonPerHour(red);
      window.dispatchEvent(new Event("cash-event-settings-updated"));

      const intervalText =
        red <= 0
          ? "빨간 버튼 꺼짐"
          : `빨간 버튼 시간당 ${red}회 · 약 ${Math.max(
              1,
              Math.round(60 / red)
            )}분마다`;

      onNotice(
        `황금티켓 ${golden}% · ${intervalText}로 저장했어.`
      );
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "이벤트 설정 저장에 실패했어."
      );
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

  async function cancelQueue(item: QueueItem) {
    if (
      !window.confirm(
        `${item.nickname}님의 ${item.item_name} 대기를 취소하고 킵으로 돌려줄까?`
      )
    ) {
      return;
    }

    setBusy(true);
    onNotice("");

    try {
      const result = await post<{ restored_item: string }>(pin, {
        action: "admin_cancel_queue",
        id: item.id,
      });

      await Promise.all([load(), onChanged()]);
      window.dispatchEvent(new Event("cash-queue-updated"));
      onNotice(
        `${item.nickname}님의 대기를 취소하고 ${result.restored_item} 킵을 1개 돌려줬어.`
      );
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "대기 취소에 실패했어."
      );
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
        <div className="text-lg font-black">이벤트 확률</div>
        <div className="mt-1 text-xs font-bold text-zinc-400">
          저장하면 다음 룰렛 추첨과 다음 빨간 버튼 예약부터 바로 적용돼.
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-black">황금티켓 확률</div>
              <div className="mt-0.5 text-[10px] font-bold text-zinc-400">
                룰렛 1회 결과가 ‘원하는 컨텐츠 룰렛 하나 킵’이 될 확률
              </div>
            </div>
            <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
              {goldenTicketPercent}%
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="number"
                min={0}
                max={100}
                value={goldenTicketPercent}
                onChange={(e) =>
                  setGoldenTicketPercent(Number(e.target.value || 0))
                }
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-10 text-lg font-black outline-none focus:border-amber-300"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black text-zinc-400">
                %
              </span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {[0, 5, 25, 50, 100].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGoldenTicketPercent(value)}
                className={
                  "rounded-xl px-2 py-2 text-xs font-black " +
                  (goldenTicketPercent === value
                    ? "bg-amber-500 text-white"
                    : "bg-amber-50 text-amber-700")
                }
              >
                {value}%
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-zinc-100 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black">빨간 버튼 등장 횟수</div>
              <div className="mt-0.5 text-[10px] font-bold text-zinc-400">
                1시간에 몇 번 나타날지 설정 · 0이면 꺼짐
              </div>
            </div>
            <div className="shrink-0 rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">
              {redButtonPerHour <= 0
                ? "꺼짐"
                : `${redButtonPerHour}회/시간 · 약 ${Math.max(
                    1,
                    Math.round(60 / redButtonPerHour)
                  )}분`}
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="number"
                min={0}
                max={60}
                value={redButtonPerHour}
                onChange={(e) =>
                  setRedButtonPerHour(Number(e.target.value || 0))
                }
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 pr-16 text-lg font-black outline-none focus:border-red-300"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-zinc-400">
                회/시간
              </span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {[
              [0, "끔"],
              [1, "1회"],
              [2, "2회"],
              [6, "10분"],
              [12, "5분"],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setRedButtonPerHour(Number(value))}
                className={
                  "rounded-xl px-2 py-2 text-xs font-black " +
                  (redButtonPerHour === Number(value)
                    ? "bg-red-600 text-white"
                    : "bg-red-50 text-red-600")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={saveEventSettings}
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-zinc-950 px-5 py-3.5 text-sm font-black text-white disabled:opacity-40"
        >
          이벤트 설정 저장
        </button>
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
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void cancelQueue(item)}
                    disabled={busy}
                    className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-40"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => completeQueue(item.id)}
                    disabled={busy}
                    className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:opacity-40"
                  >
                    완료
                  </button>
                </div>
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

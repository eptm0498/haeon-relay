export const jiwooDays = ["일", "월", "화", "수", "목", "금", "토"] as const;
export type JiwooPreferences = {
  chatPrompt: string;
  voicePrompt: string;
  workHours: string[];
  scheduleNotes: string;
  incomingCalls?: boolean;
  proactiveTexts?: boolean;
  version: number;
};

export const defaultJiwooPreferences: JiwooPreferences = {
  chatPrompt: "",
  voicePrompt: "",
  workHours: ["09:00-21:00", "16:00-21:00", "", "16:00-21:00", "", "", "09:00-21:00"],
  scheduleNotes: "2026년 11월 23~27일 오전 하남중 시간강사 출강 예정.",
  version: 0,
};

const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validWorkHours(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 7 && value.every(period => {
    if (period === "") return true;
    if (typeof period !== "string") return false;
    const parts = period.split("-");
    return parts.length === 2 && parts.every(part => clock.test(part)) && parts[0] < parts[1];
  });
}

function localShift(now: Date, settings: JiwooPreferences) {
  const local = new Date(now.getTime() + 9 * 3_600_000);
  const day = local.getUTCDay();
  const time = local.toISOString().slice(11, 16);
  const [start, end] = settings.workHours[day].split("-");
  return { time, start, end };
}

export function jiwooIsWorking(now: Date, settings: JiwooPreferences) {
  const { time, start, end } = localShift(now, settings);
  return Boolean(start && time >= start && time < end);
}

export function jiwooScheduleContext(now: Date, settings: JiwooPreferences) {
  const { time, start, end } = localShift(now, settings);
  const status = !start ? "오늘은 정규 근무가 없는 날" : time < start ? `오늘 정규 근무 시작 전 (${start} 시작)` :
    time < end ? `오늘 정규 근무 시간대 (${end} 종료 예정)` : `오늘 정규 근무 종료 시각(${end}) 이후`;
  const week = settings.workHours.map((period, index) => `${jiwooDays[index]} ${period || "정규 근무 없음"}`).join(", ");
  return `\n[도혁의 일정 · 한국 시간]\n${week}\n현재 기준 ${status}.\n별도 일정과 변경 사항: ${settings.scheduleNotes || "(없음)"}\n이 일정은 도혁의 것이고 지우 자신의 일정과 별개다. 위 기존 기본 설정의 근무시간과 다르면 이 일정표를 사용해. 날짜가 맞는 별도 일정과 도혁이 최근 직접 알려준 변경 사항을 우선해. 시간표만 보고 도혁이 실제로 출근했거나 퇴근했다고 단정하지 마. 대화와 관련될 때 출근 전·근무 중·퇴근 이후에 맞춰 자연스럽게 말하고, 매번 시간이나 근무를 언급하지 마.\n`;
}

"use client";

import {
  JIWOO_MAX_DAILY_TEXT_STARTS, JIWOO_MAX_TEXTS_PER_SERIES, type JiwooProactivePreferences,
} from "@/lib/dokyeong/jiwoo-preferences";

type Props = {
  value: JiwooProactivePreferences;
  disabled: boolean;
  onChange: (value: JiwooProactivePreferences) => void;
};

function countOptions(maximum: number) {
  return Array.from({ length: maximum }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>);
}

export default function JiwooProactiveFields({ value, disabled, onChange }: Props) {
  return <>
    <label>지우가 먼저 전화하기
      <select value={String(value.incomingCalls)} disabled={disabled}
        onChange={event => onChange({ ...value, incomingCalls: event.target.value === "true" })}>
        <option value="true">켜짐</option>
        <option value="false">꺼짐</option>
      </select>
    </label>
    <p>켜 두면 지우가 근무시간 밖에 먼저 전화할 수 있어.</p>
    <label>지우가 먼저 톡 보내기
      <select value={String(value.proactiveTexts)} disabled={disabled}
        onChange={event => onChange({ ...value, proactiveTexts: event.target.value === "true" })}>
        <option value="true">켜짐</option>
        <option value="false">꺼짐</option>
      </select>
    </label>
    <label>하루에 선톡을 시작하는 횟수
      <select value={value.proactiveDailyStarts} disabled={disabled || !value.proactiveTexts}
        onChange={event => onChange({ ...value, proactiveDailyStarts: Number(event.target.value) })}>
        {countOptions(JIWOO_MAX_DAILY_TEXT_STARTS)}
      </select>
    </label>
    <label>답장 없이 연속으로 보내는 메시지 수
      <select value={value.proactiveSeriesMessages} disabled={disabled || !value.proactiveTexts}
        onChange={event => onChange({ ...value, proactiveSeriesMessages: Number(event.target.value) })}>
        {countOptions(JIWOO_MAX_TEXTS_PER_SERIES)}
      </select>
    </label>
    <p>한국 시간 기준이야. 연속 메시지 수에 첫 톡이 포함되고, 답장하면 그 흐름은 끝나.</p>
  </>;
}

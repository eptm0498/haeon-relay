"use client";

import { jiwooRuleDefinitions, resolvedJiwooRules, JIWOO_CALL_BOUNDARY_PROMPT } from "@/lib/dokyeong/jiwoo-conversation-rules";
import { useEffect, useState } from "react";
import { jiwooDays, jiwooProactivePreferences, validWorkHours, type JiwooPreferences } from "@/lib/dokyeong/jiwoo-preferences";
import JiwooProactiveFields from "../../JiwooProactiveFields";
import styles from "./editor.module.css";

type Memory = { epoch: string; summary: string; messageCount: number };
const week = [1, 2, 3, 4, 5, 6, 0];

export default function JiwooSettings({ endpoint, memory }: { endpoint: string; memory: boolean }) {
  const url = memory ? endpoint + "?part=memory" : endpoint;
  const [settings, setSettings] = useState<JiwooPreferences | null>(null);
  const [record, setRecord] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (memory) setRecord(data);
      else setSettings({ ...data, conversationRules: resolvedJiwooRules(data) });
    }).catch(error => {
      if (!controller.signal.aborted) setNotice(error.message || "설정을 불러오지 못했어.");
    });
    return () => controller.abort();
  }, [url, memory, revision]);

  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(memory ? record : settings),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (!memory) setSettings({ ...data, conversationRules: resolvedJiwooRules(data) });
      setNotice("저장했어. 다음 대화부터 적용돼.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "저장하지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.editorCard}>
    <div className={styles.cardHeader}><div className={styles.cardTitles}>
      <h2>{memory ? "지우의 요약 기억" : "전체 대화 지침과 내 일정"}</h2>
      <p>{memory ? "대화에서 쌓인 요약 기억을 편집해." : "기본 성격은 캐릭터 설정에서, 앱이 덧붙이는 공통·상황별 대화 지침은 아래에서 전문을 보고 수정해. 요약 기억·대화 샘플·사진 앨범은 각 탭에서 확인할 수 있어."}</p>
    </div></div>
    <div className={styles.fieldArea}>
      {memory ? record && <>
        <label htmlFor="jiwoo-memory">요약 기억 · 대화 {record.messageCount}개</label>
        <textarea id="jiwoo-memory" className={styles.textarea} value={record.summary} maxLength={12000} disabled={busy} onChange={event => setRecord({ ...record, summary: event.target.value })}/>
      </> : settings && <>
        <h3>앱에서 함께 적용하는 대화 지침 전문</h3>
        <p>항목을 펼쳐 현재 적용 내용을 확인하고 수정해. 빈 값으로 저장하면 해당 추가 지침을 비워 두고, 기본값 버튼은 앱의 기본 내용을 다시 넣어.</p>
        {jiwooRuleDefinitions.map(rule => <details key={rule.key} className={styles.storySection} open={rule.key === "common"}>
          <summary>{rule.title}</summary>
          <div className={styles.storyBody}>
            <p>{rule.help}</p>
            <label htmlFor={`jiwoo-rule-${rule.key}`}>{rule.title} · 전문</label>
            <textarea id={`jiwoo-rule-${rule.key}`} className={styles.textarea} value={settings.conversationRules?.[rule.key] ?? rule.defaultValue} maxLength={8000} disabled={busy} spellCheck={false}
              onChange={event => setSettings({ ...settings, conversationRules: { ...settings.conversationRules, [rule.key]: event.target.value } })}/>
            <button type="button" className={styles.modeButton} disabled={busy} onClick={() => setSettings({ ...settings, conversationRules: { ...settings.conversationRules, [rule.key]: rule.defaultValue } })}>이 항목 기본값 불러오기</button>
          </div>
        </details>)}
        <details className={styles.storySection}>
          <summary>앱이 매번 전달하는 상황 정보와 고정 동작</summary>
          <div className={styles.storyBody}>
            <p>현재 시각·연락 가능 시간·최근 대화와 기억·사진첩 후보·카메라의 실제 전달 여부는 통화 상태에 따라 채워져. 모델은 실제로 전달된 사진과 영상 프레임만 볼 수 있어. 생성과 안전 기준, 실제 통화 제어, 앱의 출력 길이 제한은 캐릭터 지침 편집으로 바뀌지 않아.</p>
            <label htmlFor="jiwoo-fixed-boundary">통화 중 수행할 수 없는 요청에 대한 고정 지침 · 보기</label>
            <textarea id="jiwoo-fixed-boundary" className={styles.textarea} value={JIWOO_CALL_BOUNDARY_PROMPT} readOnly/>
          </div>
        </details>
        <label htmlFor="jiwoo-chat">문자 채팅 추가 지침</label>
        <textarea id="jiwoo-chat" className={styles.textarea} value={settings.chatPrompt} maxLength={8000} disabled={busy} onChange={event => setSettings({ ...settings, chatPrompt: event.target.value })}/>
        <label htmlFor="jiwoo-voice">음성 통화 추가 지침</label>
        <textarea id="jiwoo-voice" className={styles.textarea} value={settings.voicePrompt} maxLength={8000} disabled={busy} onChange={event => setSettings({ ...settings, voicePrompt: event.target.value })}/>
        <div className={styles.jiwooProactive}>
          <JiwooProactiveFields value={jiwooProactivePreferences(settings)} disabled={busy}
            onChange={value => setSettings({ ...settings, ...value })}/>
        </div>
        <h3>내 주간 근무시간</h3>
        <p>한국 시간 기준으로 09:00-21:00처럼 입력해. 비워 두면 그 요일은 정규 근무가 없는 날로 봐.</p>
        <div className={styles.jiwooWeek}>
          {week.map(day => <label key={day}>{jiwooDays[day]}요일
            <input aria-label={jiwooDays[day] + "요일 근무시간"} value={settings.workHours[day]} maxLength={11} placeholder="휴무" disabled={busy} onChange={event => {
              const workHours = [...settings.workHours];
              workHours[day] = event.target.value;
              setSettings({ ...settings, workHours });
            }}/>
          </label>)}
        </div>
        <label htmlFor="jiwoo-schedule-notes">별도 일정·휴무·변경 사항</label>
        <textarea id="jiwoo-schedule-notes" className={styles.textarea} placeholder="예: 11월 23~27일 오전 하남중 출강" maxLength={2000} value={settings.scheduleNotes} disabled={busy} onChange={event => setSettings({ ...settings, scheduleNotes: event.target.value })}/>
      </>}
      {(memory ? record : settings) && <button type="button" className={styles.primaryButton} disabled={busy || (!memory && !validWorkHours(settings?.workHours))} onClick={() => void save()}>
        {busy ? "저장 중…" : memory ? "기억 저장" : "대화 지침과 일정 저장"}
      </button>}
      <button type="button" className={styles.modeButton} disabled={busy} onClick={() => { setNotice(""); setRevision(value => value + 1); }}>다시 불러오기</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>;
}

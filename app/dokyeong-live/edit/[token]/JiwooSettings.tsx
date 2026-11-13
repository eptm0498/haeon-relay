"use client";

import { useEffect, useState } from "react";
import { jiwooDays, validWorkHours, type JiwooPreferences } from "@/lib/dokyeong/jiwoo-preferences";
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
      else setSettings(data);
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
      if (!memory) setSettings(data);
      setNotice("저장했어. 다음 대화부터 적용돼.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "저장하지 못했어.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.editorCard}>
    <div className={styles.cardHeader}><div className={styles.cardTitles}>
      <h2>{memory ? "지우의 요약 기억" : "문자·통화 지침과 내 일정"}</h2>
      <p>{memory ? "대화에서 쌓인 요약 기억을 편집해." : "공통 성격은 캐릭터 설정에서, 문자와 통화에만 적용할 지침과 근무 일정은 여기에서 바꿔."}</p>
    </div></div>
    <div className={styles.fieldArea}>
      {memory ? record && <>
        <label htmlFor="jiwoo-memory">요약 기억 · 대화 {record.messageCount}개</label>
        <textarea id="jiwoo-memory" className={styles.textarea} value={record.summary} maxLength={12000} disabled={busy} onChange={event => setRecord({ ...record, summary: event.target.value })}/>
      </> : settings && <>
        <label htmlFor="jiwoo-chat">문자 채팅 추가 지침</label>
        <textarea id="jiwoo-chat" className={styles.textarea} value={settings.chatPrompt} maxLength={8000} disabled={busy} onChange={event => setSettings({ ...settings, chatPrompt: event.target.value })}/>
        <label htmlFor="jiwoo-voice">음성 통화 추가 지침</label>
        <textarea id="jiwoo-voice" className={styles.textarea} value={settings.voicePrompt} maxLength={8000} disabled={busy} onChange={event => setSettings({ ...settings, voicePrompt: event.target.value })}/>
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

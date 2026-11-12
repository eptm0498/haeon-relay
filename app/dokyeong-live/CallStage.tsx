"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, Volume2, VolumeX } from "lucide-react";
import CharacterAvatar from "./CharacterAvatar";
import styles from "./live.module.css";

type Props = {
  name: string;
  avatar?: string | null;
  scene?: string | null;
  status: string;
  error: string;
  paused: boolean;
  reconnecting: boolean;
  speaking: boolean;
  voice: boolean;
  onEnd: () => void;
  onResume: () => void;
  onInterrupt: () => void;
  onToggleVoice: () => void;
};

export default function CallStage(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const layers = props.scene ? [...new Set([loaded, props.scene].filter((src): src is string => !!src))] : [];
  return <dialog ref={dialog} className={styles.callStage} aria-label={`${props.name} 음성 통화`}
    onCancel={event => { event.preventDefault(); props.onEnd(); }}>
    <div className={styles.callStagePhoto} aria-hidden="true">
      <CharacterAvatar name={props.name} src={props.avatar} />
      {layers.map(src => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" draggable={false} data-visible={src === loaded}
          onLoad={() => { if (src === props.scene) setLoaded(src); }}
          onError={() => { if (src === props.scene) setLoaded(null); }} />
      ))}
    </div>
    <div className={styles.callStageContent}>
      <header className={styles.callStageHeader}>
        <h1>{props.name}</h1>
        <span role="status">{props.paused ? "통화 일시 정지" : props.status}</span>
      </header>
      <div className={styles.callStageBottom}>
        {props.error && <p className={styles.callStageNotice} role="alert">{props.error}</p>}
        {props.paused && <p className={styles.callStageNotice}>이어서 통화하려면 마이크 버튼을 눌러 줘.</p>}
        {props.speaking && <button type="button" className={styles.callStageInterrupt} onClick={props.onInterrupt}>말 끊기</button>}
        <div className={styles.callStageActions}>
          <button type="button" className={styles.callStageControl} onClick={props.onToggleVoice} aria-pressed={props.voice} aria-label="상대 음성">
            <span>{props.voice ? <Volume2 /> : <VolumeX />}</span><small>음성</small>
          </button>
          {props.paused && <button type="button" className={styles.callStageControl} onClick={props.onResume} disabled={props.reconnecting} aria-label="통화 재개">
            <span><Mic /></span><small>{props.reconnecting ? "연결 중" : "재개"}</small>
          </button>}
          <button type="button" className={`${styles.callStageControl} ${styles.callStageHangup}`} onClick={props.onEnd} aria-label="통화 종료">
            <span><PhoneOff /></span><small>종료</small>
          </button>
        </div>
      </div>
    </div>
  </dialog>;
}

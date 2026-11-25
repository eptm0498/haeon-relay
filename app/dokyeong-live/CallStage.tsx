"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, CameraOff, SwitchCamera, Mic, PhoneOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import CharacterAvatar from "./CharacterAvatar";
import styles from "./live.module.css";

type Props = {
  name: string;
  avatar?: string | null;
  scene?: string | null;
  videoSource?: string;
  alternateVideoSource?: string;
  videoOn: boolean;
  onVideoChange: (on: boolean) => void;
  cameraStream?: MediaStream | null;
  cameraPreviewRef?: RefObject<HTMLVideoElement | null>;
  cameraFacing?: "user" | "environment";
  cameraBusy?: boolean;
  cameraError?: string;
  onCameraToggle?: () => void;
  onCameraFlip?: () => void;
  status: string;
  responseDelayMs: number | null;
  error: string;
  paused: boolean;
  reconnecting: boolean;
  voice: boolean;
  onEnd: () => void;
  onResume: () => void;
  onToggleVoice: () => void;
};

export default function CallStage(props: Props) {
  const { videoOn, onVideoChange } = props;
  const [useAlternateVideo, setUseAlternateVideo] = useState(false);
  const [videoError, setVideoError] = useState<"default" | "alternate" | null>(null);
  const videoSource = useAlternateVideo ? props.alternateVideoSource : props.videoSource;
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [{ loaded, previous }, setLayers] = useState<{ loaded: string | null; previous: string | null }>({ loaded: null, previous: null });
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (!previous) return;
    const timer = window.setTimeout(() => setLayers(state => ({ ...state, previous: null })), 260);
    return () => window.clearTimeout(timer);
  }, [loaded, previous]);
  const layers = props.scene ? [...new Set([previous, loaded, props.scene].filter((src): src is string => !!src))] : [];

  useEffect(() => {
    const preview = props.cameraPreviewRef?.current;
    if (!preview) return;
    preview.srcObject = props.cameraStream ?? null;
    if (props.cameraStream) void preview.play().catch(() => {});
  }, [props.cameraStream, props.cameraPreviewRef]);

  function selectVideo(alternate: boolean) {
    setUseAlternateVideo(alternate);
    setVideoError(null);
  }

  return <dialog ref={dialog} className={styles.callStage} aria-label={`${props.name} ${videoOn ? "영상" : "음성"} 통화`}
    onCancel={event => { event.preventDefault(); props.onEnd(); }}>
    <div className={styles.callStagePhoto} aria-hidden="true">
      <CharacterAvatar name={props.name} src={props.avatar} />
      {layers.map(src => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" draggable={false} data-visible={src === loaded}
          onLoad={() => {
            if (src === props.scene) setLayers(state => state.loaded === src ? state : { loaded: src, previous: state.loaded });
          }} />
      ))}
      {videoOn && videoSource && videoError !== "default" && <video key={videoSource}
        className={styles.callStageVideo} src={videoSource} autoPlay loop muted playsInline disablePictureInPicture
        onLoadedData={event => { void event.currentTarget.play().catch(() => {}); }}
        onError={() => {
          setVideoError(useAlternateVideo ? "alternate" : "default");
          setUseAlternateVideo(false);
        }} />}
      {props.cameraStream && <div className={styles.callSelfPreview} aria-label="내 카메라 미리보기">
        <video ref={props.cameraPreviewRef} autoPlay muted playsInline data-facing={props.cameraFacing ?? "user"} />
        <span>내 카메라 · AI 인식 중</span>
      </div>}
    </div>
    <div className={styles.callStageContent}>
      <header className={styles.callStageHeader}>
        <h1 ref={heading} tabIndex={-1}>{props.name}</h1>
        <span role="status">{props.paused ? "통화 일시 정지" : props.status}</span>
        {props.responseDelayMs !== null && !props.paused && <span>응답 음성 {(props.responseDelayMs / 1000).toFixed(1)}초</span>}
      </header>
      <div className={styles.callStageBottom}>
        {videoOn && videoError && <p className={styles.callStageNotice} role="status">
          {videoError === "alternate" ? "첨부 영상을 불러오지 못해서 기본 영상으로 돌아갔어." : "배경 영상을 불러오지 못했어. 통화는 계속돼."}
        </p>}
        {props.cameraError && <p className={styles.callStageNotice} role="alert">{props.cameraError}</p>}
        {props.error && <p className={styles.callStageNotice} role="alert">{props.error}</p>}
        {props.paused && <p className={styles.callStageNotice}>이어서 통화하려면 마이크 버튼을 눌러 줘.</p>}
        {videoOn && props.alternateVideoSource && <div className={styles.callVideoSwitch} role="group" aria-label="재생 영상 선택">
          <button type="button" aria-pressed={!useAlternateVideo} onClick={() => selectVideo(false)}>기본 영상</button>
          <button type="button" aria-pressed={useAlternateVideo} onClick={() => selectVideo(true)}>첨부 영상</button>
        </div>}
        <div className={styles.callStageActions}>
          <button type="button" className={styles.callStageControl} onClick={props.onToggleVoice} aria-pressed={props.voice} aria-label="상대 음성">
            <span>{props.voice ? <Volume2 /> : <VolumeX />}</span><small>음성</small>
          </button>
          {props.videoSource && <button type="button" className={styles.callStageControl}
            onClick={() => { selectVideo(false); onVideoChange(!videoOn); }}
            aria-label={videoOn ? "음성 통화로 전환" : "영상 통화로 전환"}>
            <span>{videoOn ? <VideoOff /> : <Video />}</span><small>{videoOn ? "영상 끄기" : "영상"}</small>
          </button>}
          {props.onCameraToggle && <button type="button" className={styles.callStageControl}
            onClick={props.onCameraToggle} disabled={props.cameraBusy || props.paused}
            aria-pressed={!!props.cameraStream} aria-label={props.cameraStream ? "내 카메라 끄기" : "내 카메라 켜기"}>
            <span>{props.cameraStream ? <Camera /> : <CameraOff />}</span>
            <small>{props.cameraBusy ? "연결 중" : props.cameraStream ? "내 카메라 끄기" : "내 카메라"}</small>
          </button>}
          {props.cameraStream && props.onCameraFlip && <button type="button" className={styles.callStageControl}
            onClick={props.onCameraFlip} disabled={props.cameraBusy || props.paused} aria-label="전후면 카메라 전환">
            <span><SwitchCamera /></span><small>전후면</small>
          </button>}
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

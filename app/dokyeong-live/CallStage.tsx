"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, CameraOff, SwitchCamera, Mic, MicOff, PhoneOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import CharacterAvatar from "./CharacterAvatar";
import styles from "./live.module.css";

type Props = {
  name: string;
  avatar?: string | null;
  scene?: string | null;
  videoSource?: string;
  alternateVideoSource?: string;
  completedVideoSource?: string;
  videoOn: boolean;
  onVideoChange: (on: boolean) => void;
  cameraStream?: MediaStream | null;
  cameraPreviewRef?: RefObject<HTMLVideoElement | null>;
  cameraFacing?: "user" | "environment";
  cameraBusy?: boolean;
  cameraError?: string;
  onCameraToggle?: () => void;
  onCameraFlip?: () => void;
  micMuted?: boolean;
  onToggleMic?: () => void;
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
  type VideoChoice = "default" | "alternate" | "complete";
  const [videoChoice, setVideoChoice] = useState<VideoChoice>("default");
  const [videoError, setVideoError] = useState<VideoChoice | null>(null);
  const videoSource = videoChoice === "complete" ? props.completedVideoSource
    : videoChoice === "alternate" ? props.alternateVideoSource : props.videoSource;
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

  function selectVideo(choice: "default" | "alternate" | "complete") {
    setVideoChoice(choice);
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
          setVideoError(videoChoice);
          if (videoChoice !== "default") setVideoChoice("default");
        }} />}
      {props.cameraStream && <div className={styles.callSelfPreview} aria-label="내 카메라 미리보기">
        <video ref={props.cameraPreviewRef} autoPlay muted playsInline data-facing={props.cameraFacing ?? "user"} />
        <span>{props.micMuted ? "카메라만 AI 인식 중" : "내 카메라 · AI 인식 중"}</span>
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
          {videoError === "complete" ? "영통완성 영상을 불러오지 못해서 기본 영상으로 돌아갔어." : videoError === "alternate" ? "첨부 영상을 불러오지 못해서 기본 영상으로 돌아갔어." : "배경 영상을 불러오지 못했어. 통화는 계속돼."}
        </p>}
        {props.micMuted && <p className={styles.callStageNotice} role="status">
          {!videoOn && !props.cameraStream ? "내 마이크 꺼짐 · 지우가 혼자 말하고 있어." : props.cameraStream ? "내 마이크 꺼짐 · 지우는 카메라만 보고 있어." : "내 마이크 꺼짐 · 혼잣말을 들으려면 내 카메라를 켜 줘."}
        </p>}
        {props.cameraError && <p className={styles.callStageNotice} role="alert">{props.cameraError}</p>}
        {props.error && <p className={styles.callStageNotice} role="alert">{props.error}</p>}
        {props.paused && <p className={styles.callStageNotice}>이어서 통화하려면 마이크 버튼을 눌러 줘.</p>}
        {videoOn && (props.alternateVideoSource || props.completedVideoSource) && <div className={styles.callVideoSwitch} role="group" aria-label="재생 영상 선택">
          <button type="button" aria-pressed={videoChoice === "default"} onClick={() => selectVideo("default")}>기본 영상</button>
          {props.alternateVideoSource && <button type="button" aria-pressed={videoChoice === "alternate"} onClick={() => selectVideo("alternate")}>첨부 영상</button>}
          {props.completedVideoSource && <button type="button" aria-pressed={videoChoice === "complete"} onClick={() => selectVideo("complete")}>영통완성</button>}
        </div>}
        <div className={styles.callStageActions}>
          <button type="button" className={styles.callStageControl} onClick={props.onToggleVoice} aria-pressed={props.voice} aria-label="상대 음성">
            <span>{props.voice ? <Volume2 /> : <VolumeX />}</span><small>지우 소리</small>
          </button>
          {props.videoSource && <button type="button" className={styles.callStageControl}
            onClick={() => { selectVideo("default"); onVideoChange(!videoOn); }}
            aria-label={videoOn ? "음성 통화로 전환" : "영상 통화로 전환"}>
            <span>{videoOn ? <VideoOff /> : <Video />}</span><small>{videoOn ? "영상 끄기" : "영상"}</small>
          </button>}
          {props.onToggleMic && <button type="button"
            className={styles.callStageControl} data-muted={props.micMuted ? "true" : "false"}
            onClick={props.onToggleMic} disabled={props.paused || props.reconnecting}
            aria-pressed={!!props.micMuted} aria-label={props.micMuted ? "내 마이크 켜기" : "내 마이크 끄기"}>
            <span>{props.micMuted ? <MicOff /> : <Mic />}</span><small>{props.micMuted ? "마이크 끔" : "내 마이크"}</small>
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

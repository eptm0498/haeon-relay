"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Phone } from "lucide-react";
import type { IncomingCall } from "@/lib/dokyeong/incoming-call";
import CharacterAvatar from "./CharacterAvatar";
import { resolveIncomingCall } from "./useIncomingCall";
import styles from "./live.module.css";

type Props = {
  call: IncomingCall;
  name: string;
  avatar?: string | null;
  canAnswer: boolean;
  onAccept: (id: string, context: AudioContext | null) => void;
  onDismiss: (id: string) => void;
};

export default function IncomingCallScreen({ call, name, avatar, canAnswer, onAccept, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const deciding = useRef(false);
  const slider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; start: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const seconds = Math.max(0, Math.ceil((call.expiresAt - now) / 1000));

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => { window.clearInterval(timer); element?.close(); };
  }, []);

  async function decide(action: "accept" | "decline") {
    if (deciding.current || (action === "accept" && (!canAnswer || Date.now() >= call.expiresAt))) return;
    deciding.current = true;
    setBusy(true);
    setError("");
    let context: AudioContext | null = null;
    try {
      if (action === "accept" && typeof AudioContext !== "undefined") {
        // Resume from the gesture on iOS before waiting on the server. Mic access follows acceptance.
        context = new AudioContext();
        void context.resume().catch(() => {});
      }
      const won = await resolveIncomingCall(call.id, action);
      if (won && action === "accept") {
        onAccept(call.id, context);
        context = null;
      } else {
        onDismiss(call.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "전화 상태를 확인하지 못했어.");
    } finally {
      if (context) void context.close().catch(() => {});
      deciding.current = false;
      setBusy(false);
    }
  }

  function slide(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return 0;
    const distance = Math.max(1, (slider.current?.clientWidth ?? 0) - event.currentTarget.offsetWidth - 10);
    const moved = Math.min(distance, Math.max(0, event.clientX - drag.current.start));
    setOffset(moved);
    return moved / distance;
  }

  return <dialog ref={dialog} className={styles.incomingCall} aria-labelledby="incoming-call-name"
    onCancel={event => { event.preventDefault(); void decide("decline"); }}>
    <div className={styles.incomingCallBackdrop} aria-hidden="true">
      <CharacterAvatar name={name} src={avatar}/>
    </div>
    <div className={styles.incomingCallIdentity}>
      <p>{busy ? "연결 중…" : seconds ? "LIVE 음성 통화" : "부재중 전화"}</p>
      <h1 id="incoming-call-name">{name}</h1>
    </div>
    <div className={styles.incomingCallBottom}>
      {error && <p role="alert">{error}</p>}
      <button className={styles.incomingReject} type="button" disabled={busy}
        onClick={() => seconds ? void decide("decline") : onDismiss(call.id)}>{seconds ? "거절" : "닫기"}</button>
      {seconds > 0 && <div ref={slider} className={styles.incomingSlider} data-disabled={!canAnswer || busy}>
        <span aria-hidden="true">밀어서 응답</span>
        <button type="button" aria-label="받기" disabled={busy || !canAnswer}
          style={{ transform: `translateX(${offset}px)` }}
          onClick={event => { if (event.detail === 0) void decide("accept"); }}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            drag.current = { id: event.pointerId, start: event.clientX };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={slide}
          onPointerUp={event => {
            if (drag.current?.id !== event.pointerId) return;
            const completed = slide(event) >= 0.82;
            drag.current = null;
            setOffset(0);
            if (completed) void decide("accept");
          }}
          onLostPointerCapture={() => { drag.current = null; setOffset(0); }}>
          <Phone aria-hidden="true"/>
        </button>
      </div>}
      {!canAnswer && seconds > 0 && !busy && <small role="status">통화 준비 중…</small>}
    </div>
  </dialog>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
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
        // Resume from the tap on iOS before waiting on the server. Mic access follows acceptance.
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

  return <dialog ref={dialog} className={styles.incomingCall} aria-labelledby="incoming-call-name"
    onCancel={event => { event.preventDefault(); void decide("decline"); }}>
    <div className={styles.incomingCallIdentity}>
      <div className={styles.incomingCallAvatar}><CharacterAvatar name={name} src={avatar}/></div>
      <h1 id="incoming-call-name">{name}</h1>
      <p>{busy ? "전화 상태 확인 중…" : seconds ? "수신 전화" : "부재중 전화"}</p>
    </div>
    <div className={styles.incomingCallBottom}>
      {error && <p role="alert">{error}</p>}
      <div className={styles.incomingCallActions}>
        <button type="button" disabled={busy} onClick={() => seconds ? void decide("decline") : onDismiss(call.id)}>
          <span className={styles.incomingDecline}><PhoneOff aria-hidden="true"/></span>{seconds ? "거절" : "닫기"}
        </button>
        {seconds > 0 && <button type="button" disabled={busy || !canAnswer} onClick={() => void decide("accept")}>
          <span className={styles.incomingAccept}><Phone aria-hidden="true"/></span>받기
        </button>}
      </div>
      {seconds > 0 && <small>{seconds}초 남음</small>}
    </div>
  </dialog>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { IncomingCall } from "@/lib/dokyeong/incoming-call";

const endpoint = "/api/dokyeong/incoming-call";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function resolveIncomingCall(id: string, action: "accept" | "decline" | "failed") {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action }),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 409) return false;
  if (!response.ok) throw Error("전화 상태를 확인하지 못했어. 다시 눌러줘.");
  return true;
}

export function useIncomingCall(enabled: boolean) {
  const [ringing, setRinging] = useState<IncomingCall | null>(null);
  const [notice, setNotice] = useState("");
  const intent = useRef("");
  const resolved = useRef("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("call");
    if (id && uuid.test(id)) intent.current = id;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let fetching = false;
    let timer: number;
    const poll = async () => {
      if (disposed || document.hidden || fetching) return;
      fetching = true;
      const requested = intent.current;
      try {
        const response = await fetch(endpoint + (requested ? "?id=" + requested : ""), {
          cache: "no-store", signal: AbortSignal.timeout(5000),
        });
        if (!response.ok || disposed || intent.current !== requested) return;
        const call: IncomingCall | null = await response.json();
        if (disposed || intent.current !== requested) return;
        if (requested) intent.current = "";
        if (call?.status === "ringing" && call.id !== resolved.current && call.expiresAt > Date.now()) {
          setNotice("");
          setRinging(call);
        } else {
          setRinging(null);
          if (requested) {
            setNotice(call?.status === "missed" ? "지우에게서 부재중 전화가 왔어." : "이미 종료된 전화야.");
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setNotice(""), 6500);
          }
        }
      } catch {
        // The next poll can recover from a suspended app or a dropped request.
      } finally {
        fetching = false;
        if (intent.current && intent.current !== requested) void poll();
      }
    };
    const showCall = (id: unknown) => {
      if (typeof id !== "string" || !uuid.test(id)) return;
      intent.current = id;
      void poll();
    };
    const requested = (event: Event) => showCall((event as CustomEvent).detail);
    const pushed = (event: MessageEvent) => {
      if (event.data?.type === "INCOMING_CALL") showCall(event.data.callId);
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    window.addEventListener("character-live:incoming-call", requested);
    navigator.serviceWorker?.addEventListener("message", pushed);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
      window.removeEventListener("character-live:incoming-call", requested);
      navigator.serviceWorker?.removeEventListener("message", pushed);
    };
  }, [enabled]);

  function dismiss(id: string) {
    resolved.current = id;
    setRinging(current => current?.id === id ? null : current);
  }
  return { ringing, notice, dismiss };
}

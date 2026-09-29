"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./live.module.css";

type Message = { role: "user" | "assistant"; content: string };
type Phase = "off" | "listening" | "thinking" | "speaking" | "paused";
type Status = { configured: boolean; authenticated: boolean; ready: boolean; missing: string[]; providers?: { openai: boolean; gemini: boolean; elevenlabs: boolean } };
type WakeLockHandle = { released: boolean; release: () => Promise<void> };
const storageKey = "dokyeong-live-history-v1";
const API = "/api/dokyeong";
const labels: Record<Phase, string> = { off: "통화 대기", listening: "듣고 있어", thinking: "생각 중", speaking: "말하는 중", paused: "잠시 멈춤" };

function amplifySpeech(context: AudioContext, source: AudioNode) {
  const gain = context.createGain(); gain.gain.value = 3.5;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.003; limiter.release.value = 0.15;
  source.connect(gain); gain.connect(limiter); limiter.connect(context.destination);
  return () => { source.disconnect(); gain.disconnect(); limiter.disconnect(); };
}

export default function DokyeongLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("off");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [voice, setVoice] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const messageRef = useRef<Message[]>([]);
  const phaseRef = useRef<Phase>("off");
  const running = useRef(false);
  const generation = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const audioAbortRef = useRef<Set<AbortController>>(new Set());
  const playingRef = useRef<HTMLAudioElement | null>(null);
  const activeSoundRef = useRef<AudioBufferSourceNode | null>(null);
  const queuedRef = useRef<Promise<void>>(Promise.resolve());
  const speechRef = useRef<Blob[]>([]);
  const prerollRef = useRef<Blob[]>([]);
  const headerRef = useRef<Blob | null>(null);
  const recordingRef = useRef(false);
  const pendingEndRef = useRef(false);
  const voicedAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const loudRef = useRef(0);
  const listenBoostUntilRef = useRef(0);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const setMode = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const setHistory = (next: Message[]) => { const kept = next.slice(-40); messageRef.current = kept; setMessages(kept); localStorage.setItem(storageKey, JSON.stringify(kept)); };
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "[]"); if (Array.isArray(saved)) setHistory(saved.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")); } catch {}
    fetch(`${API}/status`, { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => setError("서버에 연결하지 못했어."));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/dokyeong-sw.js", { scope: "/dokyeong-live" }).catch(() => {});
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, partial]);

  const keepAwake = useCallback(async () => {
    if (document.hidden || (wakeLockRef.current && !wakeLockRef.current.released)) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> } };
    try {
      const lock = await nav.wakeLock?.request("screen");
      if (lock) wakeLockRef.current = lock;
    } catch {}
  }, []);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }, []);

  const stopAudio = useCallback(() => {
    audioAbortRef.current.forEach((controller) => controller.abort()); audioAbortRef.current.clear();
    playingRef.current?.pause(); playingRef.current = null;
    try { activeSoundRef.current?.stop(); } catch {} activeSoundRef.current = null;
    queuedRef.current = Promise.resolve();
  }, []);
  const interrupt = useCallback(() => {
    generation.current++; requestRef.current?.abort(); requestRef.current = null;
    stopAudio(); setPartial("");
    if (running.current) setMode("listening");
  }, [stopAudio]);

  const closeMic = useCallback(() => {
    if (timerRef.current) cancelAnimationFrame(timerRef.current); timerRef.current = null;
    const recorder = recorderRef.current; recorderRef.current = null;
    if (recorder?.state !== "inactive") recorder?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    contextRef.current?.close().catch(() => {}); contextRef.current = null;
    recordingRef.current = false; pendingEndRef.current = false; prerollRef.current = []; speechRef.current = []; headerRef.current = null;
  }, []);
  const endCall = useCallback(() => { running.current = false; interrupt(); closeMic(); releaseWakeLock(); setMode("off"); setNeedsTap(false); }, [interrupt, closeMic, releaseWakeLock]);
  useEffect(() => () => {
    running.current = false;
    requestRef.current?.abort();
    audioAbortRef.current.forEach((c) => c.abort());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
    releaseWakeLock();
  }, [releaseWakeLock]);

  async function login(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch(`${API}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error || "접속할 수 없어."); return; }
    setCode(""); const fresh = await fetch(`${API}/status`, { cache: "no-store" }); setStatus(await fresh.json());
  }

  async function playSpeech(response: Promise<Response>, signal: AbortSignal, turn: number) {
    const upstream = await response;
    if (!upstream.ok || !upstream.body) throw Error("목소리 생성에 실패했어.");
    if (signal.aborted || turn !== generation.current) { upstream.body.cancel().catch(() => {}); return; }
    // MP3 MediaSource starts as soon as the first bytes arrive. Older iOS builds use the decoded-blob fallback.
    if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg")) {
      const media = new MediaSource(); const url = URL.createObjectURL(media);
      const audio = new Audio(); audio.setAttribute("playsinline", ""); audio.src = url; playingRef.current = audio;
      const outputContext = contextRef.current;
      const disconnectOutput = outputContext?.state === "running"
        ? amplifySpeech(outputContext, outputContext.createMediaElementSource(audio)) : null;
      try {
        await new Promise<void>((resolve, reject) => { media.addEventListener("sourceopen", () => resolve(), { once: true }); signal.addEventListener("abort", () => reject(Error("interrupted")), { once: true }); });
        const buffer = media.addSourceBuffer("audio/mpeg");
        const reader = upstream.body.getReader(); let started = false;
        while (true) {
          if (signal.aborted || turn !== generation.current) throw Error("interrupted");
          const { value, done } = await reader.read(); if (done) break;
          if (value?.byteLength) {
            await new Promise<void>((resolve, reject) => {
              buffer.addEventListener("updateend", () => resolve(), { once: true });
              try { buffer.appendBuffer(value); } catch (e) { reject(e); }
            });
            if (!started) { started = true; await audio.play().catch(() => { setNeedsTap(true); throw Error("재생 버튼을 눌러줘."); }); }
          }
        }
        if (media.readyState === "open" && !buffer.updating) media.endOfStream();
        if (started && !audio.ended) await new Promise<void>((resolve, reject) => {
          audio.addEventListener("ended", () => resolve(), { once: true });
          audio.addEventListener("error", () => reject(Error("재생이 끊겼어.")), { once: true });
          signal.addEventListener("abort", () => reject(Error("interrupted")), { once: true });
        });
      } finally { audio.pause(); disconnectOutput?.(); audio.src = ""; URL.revokeObjectURL(url); if (playingRef.current === audio) playingRef.current = null; }
      return;
    }
    const chunks: Uint8Array[] = []; const reader = upstream.body.getReader();
    while (true) { const { value, done } = await reader.read(); if (done) break; if (value) chunks.push(value); if (signal.aborted) return; }
    if (!chunks.length || signal.aborted || turn !== generation.current) return;
    const context = contextRef.current || new AudioContext();
    if (!contextRef.current) contextRef.current = context;
    await context.resume();
    const decoded = await context.decodeAudioData(await new Blob(chunks.map((chunk) => new Uint8Array(chunk)), { type: "audio/mpeg" }).arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      const source = context.createBufferSource(); activeSoundRef.current = source; source.buffer = decoded;
      const disconnectOutput = amplifySpeech(context, source);
      source.onended = () => { disconnectOutput(); if (activeSoundRef.current === source) activeSoundRef.current = null; resolve(); };
      signal.addEventListener("abort", () => { try { source.stop(); } catch {} reject(Error("interrupted")); }, { once: true });
      source.start();
    });
  }

  function queueSpeech(text: string, turn: number) {
    if (!voice || turn !== generation.current) return;
    // Keep chat reactions in captions, but do not ask TTS to pronounce them.
    const spokenText = text.replace(/[ㅋㅎㅠㅜ]+/g, "").replace(/^[\s,;:.!?]+/, "").replace(/\s{2,}/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(spokenText)) return;
    const controller = new AbortController(); audioAbortRef.current.add(controller);
    // Fetch now while the previous phrase plays, preserving order in queuedRef.
    const response = fetch(`${API}/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spokenText }), signal: controller.signal });
    queuedRef.current = queuedRef.current.catch(() => {}).then(async () => {
      if (controller.signal.aborted || turn !== generation.current) return;
      setMode("speaking");
      try { await playSpeech(response, controller.signal, turn); }
      catch (err) { if (!controller.signal.aborted && turn === generation.current) setError(err instanceof Error ? err.message : "음성 재생이 끊겼어."); }
      finally { audioAbortRef.current.delete(controller); }
    });
  }

  async function reply(userText: string) {
    const text = userText.trim().slice(0, 1500); if (!text) { if (running.current) setMode("listening"); return; }
    interrupt(); const turn = generation.current;
    const start = performance.now(); setLatency(null); setError("");
    const conversation = [...messageRef.current, { role: "user" as const, content: text }]; setHistory(conversation);
    setMode("thinking");
    const controller = new AbortController(); requestRef.current = controller;
    let full = ""; let complete = false; let firstSegment = true;
    try {
      const response = await fetch(`${API}/respond`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-24) }), signal: controller.signal });
      if (!response.ok || !response.body) { const body = await response.json().catch(() => ({})); throw Error(body.error || "응답을 받지 못했어."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true }); let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1); if (!line) continue;
          const event = JSON.parse(line);
          if (turn !== generation.current) return;
          if (event.type === "delta") { full += event.text; setPartial(full); }
          if (event.type === "segment") { if (firstSegment) { firstSegment = false; setLatency(Math.round(performance.now() - start)); } queueSpeech(event.text, turn); }
          if (event.type === "error") throw Error(event.message);
          if (event.type === "done") { full = event.text || full; complete = true; }
        }
      }
      if (!complete || !full.trim()) throw Error("답장을 끝까지 받지 못했어.");
      setHistory([...conversation, { role: "assistant", content: full.trim() }]); setPartial("");
      if (voice) await queuedRef.current;
    } catch (err) { if (!controller.signal.aborted && turn === generation.current) { setError(err instanceof Error ? err.message : "연결이 끊겼어."); setPartial(""); } }
    finally {
      if (turn === generation.current) {
        requestRef.current = null;
        if (running.current) {
          prerollRef.current = [];
          loudRef.current = 0;
          listenBoostUntilRef.current = performance.now() + 2600;
          setMode("listening");
        } else setMode("off");
      }
    }
  }

  async function onSpeech(blob: Blob) {
    if (!running.current || blob.size < 1000) return;
    interrupt(); const turn = generation.current; setMode("thinking"); setError("");
    const form = new FormData(); form.append("audio", blob, blob.type.includes("mp4") ? "speech.mp4" : "speech.webm");
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const response = await fetch(`${API}/transcribe`, { method: "POST", body: form, signal: controller.signal });
      const result = await response.json(); if (!response.ok) throw Error(result.error || "못 들었어.");
      if (turn !== generation.current) return;
      if (result.text) await reply(result.text); else setMode("listening");
    } catch (err) { if (!controller.signal.aborted && turn === generation.current) { setError(err instanceof Error ? err.message : "못 들었어."); setMode("listening"); } }
  }

  async function startCall() {
    setError(""); setNeedsTap(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("이 브라우저는 마이크 녹음을 지원하지 않아."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const context = new AudioContext(); await context.resume();
      const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      streamRef.current = stream; contextRef.current = context; recorderRef.current = recorder; running.current = true; setMode("listening"); void keepAwake();
      recorder.ondataavailable = (event) => {
        if (!event.data.size || !running.current) return;
        // Safari's fragmented MP4 and WebM need their first container header on each STT upload.
        if (!headerRef.current) headerRef.current = event.data;
        if (recordingRef.current || pendingEndRef.current) speechRef.current.push(event.data);
        else if (phaseRef.current === "listening") {
          prerollRef.current.push(event.data);
          if (prerollRef.current.length > 5) prerollRef.current.shift();
        }
        if (pendingEndRef.current) {
          pendingEndRef.current = false; recordingRef.current = false;
          const utterance = new Blob(speechRef.current, { type: recorder.mimeType }); speechRef.current = []; prerollRef.current = [];
          if (utterance.size) void onSpeech(utterance);
        }
      };
      recorder.start(220);
      stream.getAudioTracks()[0].onended = () => { if (running.current) { endCall(); setError("마이크가 끊겼어. 다시 연결해 줘."); } };
      const data = new Float32Array(analyser.fftSize); let lastFrame = 0; let noise = 0.012;
      const loop = (time: number) => {
        if (!running.current) return;
        timerRef.current = requestAnimationFrame(loop);
        if (time - lastFrame < 55) return; lastFrame = time;
        analyser.getFloatTimeDomainData(data);
        let energy = 0; for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
        const rms = Math.sqrt(energy / data.length);
        const speaking = phaseRef.current === "speaking";
        const justFinishedSpeaking = !speaking && time < listenBoostUntilRef.current;
        const threshold = speaking
          ? Math.max(0.095, noise * 6)
          : justFinishedSpeaking
            ? Math.max(0.010, noise * 1.55)
            : Math.max(0.017, noise * 2.05);
        if (!recordingRef.current && !speaking && !justFinishedSpeaking && rms < threshold) noise = noise * 0.985 + rms * 0.015;
        loudRef.current = rms > threshold ? loudRef.current + 1 : 0;
        if (!recordingRef.current && !pendingEndRef.current && loudRef.current >= (speaking ? 5 : justFinishedSpeaking ? 1 : 2)) {
          if (phaseRef.current === "speaking" || phaseRef.current === "thinking") interrupt();
          recordingRef.current = true; speechRef.current = [headerRef.current, ...prerollRef.current.filter((part) => part !== headerRef.current)].filter((part): part is Blob => !!part); prerollRef.current = [];
          startedAtRef.current = time; voicedAtRef.current = time; loudRef.current = 0; setMode("listening");
        }
        if (recordingRef.current) {
          if (rms > threshold * 0.7) voicedAtRef.current = time;
          if (time - voicedAtRef.current > 850 && time - startedAtRef.current > 450) { pendingEndRef.current = true; recorder.requestData(); recordingRef.current = false; }
          if (time - startedAtRef.current > 18_000) { pendingEndRef.current = true; recorder.requestData(); recordingRef.current = false; }
        }
      };
      timerRef.current = requestAnimationFrame(loop);
    } catch { closeMic(); running.current = false; setMode("off"); setError("마이크 권한을 확인하고 다시 눌러줘."); }
  }

  useEffect(() => {
    const recover = () => {
      if (document.hidden && running.current) {
        releaseWakeLock(); interrupt(); closeMic(); setMode("paused"); setNeedsTap(true);
      } else if (!document.hidden && running.current && phaseRef.current !== "paused") {
        void keepAwake();
      } else if (!document.hidden && phaseRef.current === "paused") setNeedsTap(true);
    };
    document.addEventListener("visibilitychange", recover);
    return () => document.removeEventListener("visibilitychange", recover);
  }, [interrupt, closeMic, keepAwake, releaseWakeLock]);

  function restart() { endCall(); setHistory([]); setPartial(""); setError(""); setLatency(null); }
  function submitText(event: FormEvent) { event.preventDefault(); if (!draft.trim()) return; const value = draft; setDraft(""); void reply(value); }

  return <main className={styles.shell}>
    <div className={styles.phone}>
      <header className={styles.top}><span className={styles.overline}>도경LIVE</span><button className={styles.restart} onClick={restart} aria-label="대화 새로 시작">새 대화</button></header>
      <div className={styles.hero}>
        <div className={`${styles.avatar} ${phase === "speaking" ? styles.speaking : ""} ${phase === "listening" ? styles.listening : ""}`} aria-hidden="true"><span>도경</span></div>
        <h1>도경</h1><p className={styles.state}><span className={styles.dot} />{labels[phase]}</p>
        {latency !== null && <p className={styles.latency}>첫 문장까지 {(latency / 1000).toFixed(1)}초</p>}
      </div>
      <section className={styles.transcript} ref={scrollRef} aria-live="polite">
        {captions && messages.slice(-16).map((message, index) => <div key={index} className={`${styles.line} ${message.role === "user" ? styles.mine : styles.his}`}><span>{message.role === "user" ? "형" : "도경"}</span><p>{message.content}</p></div>)}
        {captions && partial && <div className={`${styles.line} ${styles.his}`}><span>도경</span><p>{partial}</p></div>}
        {!captions && <p className={styles.empty}>자막 꺼짐</p>}
        {captions && !messages.length && !partial && <p className={styles.empty}>마이크를 누르고 편하게 말해.</p>}
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {status && !status.configured && <p className={styles.notice}>서버 접속 코드 설정이 필요해.</p>}
      {status?.authenticated && !status.ready && <p className={styles.notice}>서버 환경변수 설정 필요: {status.missing.join(", ")}</p>}
      {status?.configured && !status.authenticated && <form onSubmit={login} className={styles.login}><input type="password" autoComplete="current-password" aria-label="접속 코드" placeholder="접속 코드" value={code} onChange={(e) => setCode(e.target.value)} /><button type="submit">입장</button></form>}
      {status?.authenticated && <>
        <form onSubmit={submitText} className={styles.textForm}><input aria-label="문자로 말하기" placeholder="문자로 말하기" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1500} /><button type="submit" disabled={!draft.trim()}>전송</button></form>
        <div className={styles.controls}>
          <button className={styles.smallButton} onClick={() => { setVoice(!voice); if (voice) stopAudio(); }} aria-label={voice ? "음성 끄기" : "음성 켜기"} aria-pressed={voice}><span>{voice ? "◖))" : "◖×"}</span>음성</button>
          <button className={`${styles.callButton} ${running.current && phase !== "paused" ? styles.endButton : ""}`} onClick={() => { if (running.current && phase !== "paused") endCall(); else { if (phase === "paused") { closeMic(); running.current = false; } void startCall(); } }} disabled={!status.ready} aria-label={running.current && phase !== "paused" ? "통화 종료" : "마이크 시작"}>{running.current && phase !== "paused" ? "■" : "♩"}</button>
          <button className={styles.smallButton} onClick={() => setCaptions(!captions)} aria-label={captions ? "자막 끄기" : "자막 켜기"} aria-pressed={captions}><span>▤</span>자막</button>
        </div>
        <div className={styles.bottom}><span>{needsTap ? "재생 또는 마이크 연결을 위해 가운데 버튼을 눌러줘" : running.current ? "말을 멈추면 도경이 대답해" : "가운데 버튼을 눌러 통화 시작"}</span>{phase === "speaking" && <button onClick={interrupt}>말 끊기</button>}</div>
      </>}
    </div>
  </main>;
}

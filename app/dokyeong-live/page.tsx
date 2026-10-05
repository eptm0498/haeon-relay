"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./live.module.css";
import { dokyeongFaceDataUrl } from "./dokyeong-face";

type Message = { role: "user" | "assistant"; content: string; ts?: number };
type ChatMode = "text" | "voice";
type Phase = "off" | "listening" | "thinking" | "speaking" | "paused";
type Status = { configured: boolean; authenticated: boolean; ready: boolean; missing: string[]; providers?: { openai: boolean; gemini: boolean; elevenlabs: boolean } };
type LiveCharacter = { id: string; name: string; voice_id: string; voice_name: string; avatar_url: string | null; is_default: boolean; sort_order: number };
type LiveVoice = { voice_id: string; name: string; category: string; labels?: Record<string,string> };
type WakeLockHandle = { released: boolean; release: () => Promise<void> };
const historyKey = (characterId: string) => `character-live-history-v2:${characterId}`;
const voiceKey = (characterId: string) => `character-live-voice-v1:${characterId}`;
const API = "/api/dokyeong";
const labels: Record<Phase, string> = { off: "대기 중", listening: "듣고 있어", thinking: "답장 쓰는 중", speaking: "말하는 중", paused: "잠시 멈춤" };

function formatMessageTime(ts?: number) {
  if (!ts) return "";
  const date = new Date(ts);
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${minute}`;
}

function hasMeaningfulTranscript(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^[\[\(【]?(음악|잡음|소음|박수|노래|기침|숨소리|music|noise|applause|laughter)[\]\)】]?[.!?…\s]*$/iu.test(text)) return false;
  return /[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]/u.test(text);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
  const [chatMode, setChatMode] = useState<ChatMode>("text");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [voice, setVoice] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [characters, setCharacters] = useState<LiveCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [availableVoices, setAvailableVoices] = useState<LiveVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const messageRef = useRef<Message[]>([]);
  const characterIdRef = useRef("");
  const voiceIdRef = useRef("");
  const chatModeRef = useRef<ChatMode>("text");
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
  const pcmSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
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
  const lastInputAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const setMode = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const setHistory = (next: Message[]) => {
    const kept = next.slice(-40);
    messageRef.current = kept;
    setMessages(kept);
    if (characterIdRef.current) localStorage.setItem(historyKey(characterIdRef.current), JSON.stringify(kept));
  };
  useEffect(() => {
    fetch(`${API}/status`, { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => setError("서버에 연결하지 못했어."));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/dokyeong-sw.js", { scope: "/dokyeong-live" }).catch(() => {});
  }, []);

  const loadCharacters = useCallback(async () => {
    try {
      const response = await fetch(`${API}/characters`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "캐릭터를 불러오지 못했어.");
      const list: LiveCharacter[] = Array.isArray(data.characters) ? data.characters : [];
      setCharacters(list);
      const selected = list.find((item) => item.id === characterIdRef.current) || list.find((item) => item.is_default) || list[0];
      if (!selected) return;
      const changed = characterIdRef.current !== selected.id;
      characterIdRef.current = selected.id;
      setCharacterId(selected.id);
      const selectedVoice = localStorage.getItem(voiceKey(selected.id)) || selected.voice_id;
      voiceIdRef.current = selectedVoice;
      setVoiceId(selectedVoice);
      if (changed || !messageRef.current.length) {
        let saved: Message[] = [];
        try {
          const raw = localStorage.getItem(historyKey(selected.id)) || (selected.is_default ? localStorage.getItem("dokyeong-live-history-v1") : null) || "[]";
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) saved = parsed.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role:m.role, content:m.content, ts:typeof m.ts === "number" ? m.ts : undefined })).slice(-40);
        } catch {}
        messageRef.current = saved; setMessages(saved); setPartial("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "캐릭터를 불러오지 못했어.");
    }
  }, []);
  useEffect(() => { if (status?.authenticated) void loadCharacters(); }, [status?.authenticated, loadCharacters]);

  const loadVoices = useCallback(async () => {
    try {
      const response = await fetch(`${API}/voices`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "목소리를 불러오지 못했어.");
      setAvailableVoices(Array.isArray(data.voices) ? data.voices : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "목소리를 불러오지 못했어.");
    }
  }, []);
  useEffect(() => { if (status?.authenticated) void loadVoices(); }, [status?.authenticated, loadVoices]);

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
    pcmSourcesRef.current.forEach((source) => { try { source.stop(); } catch {} });
    pcmSourcesRef.current.clear();
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
    if (chatModeRef.current !== "voice" || !voice || turn !== generation.current) return;
    // Keep chat reactions in captions, but do not ask TTS to pronounce them.
    const spokenText = text.replace(/[ㅋㅎㅠㅜ]+/g, "").replace(/^[\s,;:.!?]+/, "").replace(/\s{2,}/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(spokenText)) return;
    const controller = new AbortController(); audioAbortRef.current.add(controller);
    // Send one complete reply per TTS request so ElevenLabs keeps one voice, breath, and prosody curve.
    const response = fetch(`${API}/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spokenText, characterId: characterIdRef.current || null, voiceId: voiceIdRef.current || null }), signal: controller.signal });
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
    const conversation = [...messageRef.current, { role: "user" as const, content: text, ts: Date.now() }]; setHistory(conversation);
    setMode("thinking");
    const controller = new AbortController(); requestRef.current = controller;

    let full = "";
    let complete = false;
    let textCommitted = false;
    let gotStreamingAudio = false;
    let streamingAudioComplete = false;
    let firstAudio = true;
    let pcmNextAt = 0;
    let lastPcmEnd: Promise<void> = Promise.resolve();

    const commitText = (value?: string) => {
      const completed = (value || full).trim();
      if (!completed || textCommitted || turn !== generation.current) return;
      full = completed;
      textCommitted = true;
      complete = true;
      setHistory([...conversation, { role: "assistant", content: completed, ts: Date.now() }]);
      setPartial("");
    };

    const playPcmChunk = (encoded: string) => {
      if (!voice || controller.signal.aborted || turn !== generation.current) return false;
      const context = contextRef.current;
      if (!context || context.state !== "running") return false;

      const bytes = base64ToBytes(encoded);
      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (!sampleCount) return false;

      const audioBuffer = context.createBuffer(1, sampleCount, 24000);
      const channel = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < sampleCount; i++) channel[i] = view.getInt16(i * 2, true) / 32768;

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      pcmSourcesRef.current.add(source);
      const disconnectOutput = amplifySpeech(context, source);

      const now = context.currentTime;
      const startAt = pcmNextAt > now ? pcmNextAt : now + (firstAudio ? 0.12 : 0.035);
      pcmNextAt = startAt + audioBuffer.duration;

      lastPcmEnd = new Promise<void>((resolve) => {
        source.onended = () => {
          disconnectOutput();
          pcmSourcesRef.current.delete(source);
          resolve();
        };
      });
      source.start(startAt);

      if (firstAudio) {
        firstAudio = false;
        setLatency(Math.round(performance.now() - start));
        setMode("speaking");
      }
      return true;
    };

    try {
      const response = await fetch(`${API}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-24), voice: chatModeRef.current === "voice" && voice, characterId: characterIdRef.current || null, voiceId: voiceIdRef.current || null }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw Error(body.error || "응답을 받지 못했어.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });

        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line) continue;

          let event: any;
          try { event = JSON.parse(line); } catch { continue; }
          if (turn !== generation.current) return;

          if (event.type === "delta" && typeof event.text === "string") {
            full += event.text;
            if (!textCommitted) setPartial(full);
          }

          if (event.type === "text_done") {
            if (typeof event.text === "string" && event.text.trim()) full = event.text;
            commitText(full);
          }

          if (event.type === "audio" && typeof event.data === "string") {
            gotStreamingAudio = playPcmChunk(event.data) || gotStreamingAudio;
          }

          if (event.type === "audio_done") streamingAudioComplete = true;

          if (event.type === "error") {
            if (full.trim()) {
              commitText(full);
              complete = true;
            } else {
              throw Error(event.message || "응답을 받지 못했어.");
            }
          }

          if (event.type === "done") {
            if (typeof event.text === "string" && event.text.trim()) full = event.text;
            commitText(full);
            complete = !!full.trim();
          }
        }
      }

      // If the transport ended after deltas but before a final marker, keep the answer instead of erasing it.
      if (!textCommitted && full.trim()) commitText(full);
      if (!complete || !full.trim()) throw Error("답장을 끝까지 받지 못했어.");

      if (chatModeRef.current === "voice" && voice) {
        if (gotStreamingAudio) {
          await lastPcmEnd;
          // A missing final marker should not delete text or surface a fatal UI error.
          if (!streamingAudioComplete) setMode("listening");
        } else {
          setLatency(Math.round(performance.now() - start));
          queueSpeech(full.trim(), turn);
          await queuedRef.current;
        }
      }
    } catch (err) {
      if (!controller.signal.aborted && turn === generation.current) {
        if (full.trim()) {
          commitText(full);
        } else {
          setError(err instanceof Error ? err.message : "연결이 끊겼어.");
          setPartial("");
        }
      }
    } finally {
      if (turn === generation.current) {
        requestRef.current = null;
        if (running.current) {
          prerollRef.current = [];
          loudRef.current = 0;
          listenBoostUntilRef.current = performance.now() + 2600;
          lastInputAtRef.current = performance.now();
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
      if (hasMeaningfulTranscript(result.text)) {
        lastInputAtRef.current = performance.now();
        await reply(String(result.text));
      } else {
        setMode("listening");
      }
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
      streamRef.current = stream; contextRef.current = context; recorderRef.current = null; running.current = true; lastInputAtRef.current = performance.now(); setMode("listening"); void keepAwake();

      const beginUtterance = (time: number) => {
        if (!running.current || recordingRef.current || pendingEndRef.current) return;
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks: Blob[] = [];
        recorderRef.current = recorder;
        recordingRef.current = true;
        pendingEndRef.current = false;
        startedAtRef.current = time;
        voicedAtRef.current = time;
        loudRef.current = 0;

        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          if (recorderRef.current === recorder) recorderRef.current = null;
          recordingRef.current = false;
          pendingEndRef.current = false;
          if (!running.current || !chunks.length) return;
          const utterance = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
          if (utterance.size >= 1000) void onSpeech(utterance);
        };
        recorder.start();
      };

      const finishUtterance = () => {
        if (!recordingRef.current || pendingEndRef.current) return;
        pendingEndRef.current = true;
        const recorder = recorderRef.current;
        recordingRef.current = false;
        if (recorder?.state === "recording") recorder.stop();
        else pendingEndRef.current = false;
      };

      stream.getAudioTracks()[0].onended = () => { if (running.current) { endCall(); setError("마이크가 끊겼어. 다시 연결해 줘."); } };
      const data = new Float32Array(analyser.fftSize); let lastFrame = 0; let noise = 0.010;
      const loop = (time: number) => {
        if (!running.current) return;
        timerRef.current = requestAnimationFrame(loop);
        if (time - lastFrame < 45) return; lastFrame = time;
        analyser.getFloatTimeDomainData(data);
        let energy = 0; for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
        const rms = Math.sqrt(energy / data.length);
        const speaking = phaseRef.current === "speaking";
        const justFinishedSpeaking = !speaking && time < listenBoostUntilRef.current;
        const threshold = speaking
          ? Math.max(0.045, noise * 3.2)
          : justFinishedSpeaking
            ? Math.max(0.0055, noise * 1.10)
            : Math.max(0.0070, noise * 1.25);

        if (!recordingRef.current && !speaking && !justFinishedSpeaking && rms < threshold) noise = noise * 0.99 + rms * 0.01;
        loudRef.current = rms > threshold ? loudRef.current + 1 : 0;

        if (phaseRef.current === "listening" && !recordingRef.current && !pendingEndRef.current && time - lastInputAtRef.current >= 60_000) {
          endCall();
          setError("1분 동안 제대로 인식된 말이 없어서 마이크를 껐어.");
          return;
        }

        if (!recordingRef.current && !pendingEndRef.current && loudRef.current >= (speaking ? 2 : 1)) {
          if (phaseRef.current === "speaking" || phaseRef.current === "thinking") interrupt();
          beginUtterance(time);
          setMode("listening");
        }

        if (recordingRef.current) {
          if (rms > threshold * 0.45) voicedAtRef.current = time;
          if (time - voicedAtRef.current > 900 && time - startedAtRef.current > 350) finishUtterance();
          if (time - startedAtRef.current > 18_000) finishUtterance();
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
  function switchChatMode(next: ChatMode) {
    if (next === chatModeRef.current) return;
    if (running.current || phaseRef.current === "speaking" || phaseRef.current === "thinking") endCall();
    else stopAudio();
    chatModeRef.current = next;
    setChatMode(next);
    setError("");
    setNeedsTap(false);
  }
  function switchCharacter(nextId: string) {
    const next = characters.find((item) => item.id === nextId);
    if (!next || next.id === characterIdRef.current) return;
    endCall();
    characterIdRef.current = next.id;
    setCharacterId(next.id);
    const nextVoice = localStorage.getItem(voiceKey(next.id)) || next.voice_id;
    voiceIdRef.current = nextVoice;
    setVoiceId(nextVoice);
    let saved: Message[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey(next.id)) || "[]");
      if (Array.isArray(parsed)) saved = parsed.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role:m.role, content:m.content, ts:typeof m.ts === "number" ? m.ts : undefined })).slice(-40);
    } catch {}
    messageRef.current = saved; setMessages(saved); setPartial(""); setError(""); setLatency(null);
  }
  function changeVoice(nextVoiceId: string) {
    if (!nextVoiceId || nextVoiceId === voiceIdRef.current) return;
    voiceIdRef.current = nextVoiceId;
    setVoiceId(nextVoiceId);
    if (characterIdRef.current) localStorage.setItem(voiceKey(characterIdRef.current), nextVoiceId);
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") interrupt();
    else stopAudio();
  }
  function submitText(event: FormEvent) { event.preventDefault(); if (!draft.trim()) return; const value = draft; if (running.current) lastInputAtRef.current = performance.now(); setDraft(""); void reply(value); }

  const activeCharacter = characters.find((item) => item.id === characterId) || characters.find((item) => item.is_default) || characters[0] || null;
  const activeName = activeCharacter?.name || "캐릭터";
  const activeAvatar = activeCharacter?.avatar_url || (activeName === "도경" ? dokyeongFaceDataUrl : null);

  return <main className={styles.shell}>
    <div className={styles.phone}>
      <header className={styles.top}><span className={styles.overline}>CHARACTER LIVE</span><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>{characters.length>1 && <select aria-label="캐릭터 선택" value={characterId} onChange={(e)=>switchCharacter(e.target.value)} style={{maxWidth:110,background:"#15161b",color:"#f3eee9",border:"1px solid #393a42",borderRadius:10,padding:"7px 9px"}}>{characters.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}{activeCharacter && availableVoices.length>0 && <select aria-label="목소리 선택" value={voiceId || activeCharacter.voice_id} onChange={(e)=>changeVoice(e.target.value)} style={{maxWidth:125,background:"#15161b",color:"#f3eee9",border:"1px solid #393a42",borderRadius:10,padding:"7px 9px"}}>{voiceId && !availableVoices.some((item)=>item.voice_id===voiceId) && <option value={voiceId}>{activeCharacter.voice_name || "현재 목소리"}</option>}{availableVoices.map((item)=><option key={item.voice_id} value={item.voice_id}>{item.name}</option>)}</select>}<button className={styles.restart} onClick={restart} aria-label="대화 새로 시작">새 대화</button></div></header>
      <div className={styles.hero}>
        <div className={`${styles.avatar} ${phase === "speaking" ? styles.speaking : ""} ${phase === "listening" ? styles.listening : ""}`} aria-hidden="true">{activeAvatar ? <img src={activeAvatar} alt="" /> : <span>{activeName.slice(0,2)}</span>}</div>
        <h1>{activeName}</h1><p className={styles.state}><span className={styles.dot} />{labels[phase]}</p>
        {latency !== null && <p className={styles.latency}>첫 음성까지 {(latency / 1000).toFixed(1)}초</p>}
      </div>
      <section className={styles.transcript} ref={scrollRef} aria-live="polite">
        {captions && messages.slice(-16).map((message, index) => <div key={index} className={`${styles.line} ${message.role === "user" ? styles.mine : styles.his}`}><span>{message.role === "user" ? "나" : activeName}</span><p>{message.content}</p></div>)}
        {captions && partial && <div className={`${styles.line} ${styles.his}`}><span>{activeName}</span><p>{partial}</p></div>}
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
        <div className={styles.bottom}><span>{needsTap ? "재생 또는 마이크 연결을 위해 가운데 버튼을 눌러줘" : running.current ? `말을 멈추면 ${activeName}이 대답해` : "가운데 버튼을 눌러 통화 시작"}</span>{phase === "speaking" && <button onClick={interrupt}>말 끊기</button>}</div>
      </>}
    </div>
  </main>;
}

"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./live.module.css";
import CharacterAvatar from "./CharacterAvatar";

type ChatImage = { dataUrl: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; name?: string };
type Message = { role: "user" | "assistant"; content: string; ts?: number; image?: ChatImage };
type ChatMode = "text" | "voice";
type AppView = "list" | "chat";
type ChatPreview = { text: string; ts?: number };
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

function formatListTime(ts?: number) {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThatDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startThatDay) / 86400000);
  if (diffDays === 0) return formatMessageTime(ts);
  if (diffDays === 1) return "어제";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
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

async function prepareChatImage(file: File): Promise<ChatImage> {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 보낼 수 있어.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("사진을 읽지 못했어."));
      el.src = objectUrl;
    });
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1280 / Math.max(1, longest));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("사진을 처리하지 못했어.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 1_650_000 && quality > 0.5) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > 1_850_000) throw new Error("사진이 너무 커. 다른 사진으로 보내줘.");
    return { dataUrl, mimeType: "image/jpeg", name: file.name };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function DokyeongLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("off");
  const [chatMode, setChatMode] = useState<ChatMode>("text");
  const [view, setView] = useState<AppView>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [chatPreviews, setChatPreviews] = useState<Record<string, ChatPreview>>({});
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
  const imagePickerRef = useRef<HTMLInputElement | null>(null);

  const setMode = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const setHistory = (next: Message[]) => {
    const kept = next.slice(-40);
    messageRef.current = kept;
    setMessages(kept);
    if (characterIdRef.current) {
      const stored = kept.map((m) => m.image
        ? { role: m.role, content: m.content || "[사진]", ts: m.ts }
        : { role: m.role, content: m.content, ts: m.ts });
      try { localStorage.setItem(historyKey(characterIdRef.current), JSON.stringify(stored)); } catch {}
      const last = kept.at(-1);
      if (last) setChatPreviews((prev) => ({
        ...prev,
        [characterIdRef.current]: { text: last.image && !last.content ? "사진" : last.content || "사진", ts: last.ts },
      }));
    }
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
      const previews: Record<string, ChatPreview> = {};
      for (const item of list) {
        try {
          const raw = localStorage.getItem(historyKey(item.id)) || (item.is_default ? localStorage.getItem("dokyeong-live-history-v1") : null) || "[]";
          const parsed = JSON.parse(raw);
          const last = Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === "string").at(-1) : null;
          if (last) previews[item.id] = { text: String(last.content || ""), ts: typeof last.ts === "number" ? last.ts : undefined };
        } catch {}
      }
      setChatPreviews(previews);
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

  useEffect(() => {
    if (!status?.authenticated) return;
    const refresh = () => { if (!document.hidden) void loadCharacters(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [status?.authenticated, loadCharacters]);

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

  async function reply(userText: string, image?: ChatImage) {
    const text = userText.trim().slice(0, 1500);
    if (!text && !image) { if (running.current) setMode("listening"); return; }
    interrupt(); const turn = generation.current;
    const start = performance.now(); setLatency(null); setError("");
    const conversation = [...messageRef.current, { role: "user" as const, content: text, ts: Date.now(), image }]; setHistory(conversation);
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
        body: JSON.stringify({
          messages: conversation.slice(-24).map((m, index, arr) => {
            const base: any = { role: m.role, content: m.content || (m.image ? "[사진을 보냈어]" : "") };
            if (index === arr.length - 1 && m.image) {
              base.image = { mimeType: m.image.mimeType, data: m.image.dataUrl.split(",")[1] || "" };
            }
            return base;
          }),
          voice: chatModeRef.current === "voice" && voice,
          characterId: characterIdRef.current || null,
          voiceId: voiceIdRef.current || null,
        }),
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
  function openConversation(nextId: string) {
    switchCharacter(nextId);
    setView("chat");
  }
  function closeVoicePanel() {
    if (chatModeRef.current === "voice") switchChatMode("text");
  }
  async function sendPickedImage(file?: File) {
    if (!file) return;
    try {
      setError("");
      const image = await prepareChatImage(file);
      await reply("", image);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사진을 보내지 못했어.");
    } finally {
      if (imagePickerRef.current) imagePickerRef.current.value = "";
    }
  }
  function submitText(event: FormEvent) { event.preventDefault(); if (!draft.trim()) return; const value = draft; if (running.current) lastInputAtRef.current = performance.now(); setDraft(""); void reply(value); }

  const activeCharacter = characters.find((item) => item.id === characterId) || characters.find((item) => item.is_default) || characters[0] || null;
  const activeName = activeCharacter?.name || "캐릭터";
  const activeAvatar = activeCharacter?.avatar_url;

  const activeVoiceName = availableVoices.find((item) => item.voice_id === voiceId)?.name || activeCharacter?.voice_name || "목소리";
  const showMessages = chatMode === "text" || captions;
  const avatarFor = (item: LiveCharacter) => item.avatar_url;

  if (view === "list" && status?.authenticated) {
    const listItems = [...characters]
      .filter((item) => !listQuery.trim() || item.name.toLowerCase().includes(listQuery.trim().toLowerCase()))
      .sort((a, b) => (chatPreviews[b.id]?.ts || 0) - (chatPreviews[a.id]?.ts || 0) || a.sort_order - b.sort_order);

    return <main className={styles.shell}>
      <div className={styles.phone}>
        <header className={styles.listHeader}>
          <div className={styles.listTitleRow}>
            <strong>채팅</strong>
            <div className={styles.listHeaderActions}>
              <button onClick={() => { setListSearchOpen((open) => !open); if (listSearchOpen) setListQuery(""); }} aria-label="채팅 검색">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></svg>
              </button>
              <button onClick={() => { const first = characters[0]; if (first) openConversation(first.id); }} aria-label="새 채팅">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"/><path d="M15.5 3v5M13 5.5h5"/></svg>
              </button>
              <button onClick={() => { const current = activeCharacter || characters[0]; if (current) { openConversation(current.id); setSettingsOpen(true); } }} aria-label="설정">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1a7 7 0 0 0-1.7-1L14.4 3h-4.8l-.4 3.1a7 7 0 0 0-1.7 1L5 6.1 3 9.5 5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.5-1a7 7 0 0 0 1.7 1l.4 3.1h4.8l.4-3.1a7 7 0 0 0 1.7-1l2.5 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>
              </button>
            </div>
          </div>

          {listSearchOpen && <div className={styles.listSearch}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></svg>
            <input autoFocus value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="채팅방 검색" />
            {listQuery && <button onClick={() => setListQuery("")} aria-label="검색어 지우기">×</button>}
          </div>}

          <div className={styles.listFilters} aria-label="채팅 필터">
            <span className={styles.filterActive}>전체</span>
            <span>안읽음</span>
            <span>통화</span>
            <span className={styles.filterIcon}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M8 12h11M11 18h8"/><circle cx="17" cy="6" r="1.5"/></svg>
            </span>
          </div>
        </header>

        <section className={styles.chatList}>
          {listItems.map((item) => {
            const preview = chatPreviews[item.id];
            const avatar = avatarFor(item);
            return <button key={item.id} className={styles.chatListRow} onClick={() => openConversation(item.id)}>
              <span className={styles.listAvatar}><CharacterAvatar name={item.name} src={avatar}/></span>
              <span className={styles.listCopy}>
                <strong>{item.name}</strong>
                <small>{preview?.text || "대화를 시작해."}</small>
              </span>
              <time>{formatListTime(preview?.ts)}</time>
            </button>;
          })}
          {!listItems.length && <div className={styles.listEmpty}>검색 결과가 없어.</div>}
        </section>
      </div>
    </main>;
  }

  return <main className={styles.shell}>
    <div className={styles.phone}>
      <header className={styles.chatHeader}>
        <button className={styles.backButton} onClick={() => { endCall(); setSettingsOpen(false); setView("list"); }} aria-label="채팅 목록">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" /></svg>
        </button>
        <button className={styles.headerTitle} onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen}>
          <strong>{activeName}</strong>
        </button>
        <div className={styles.headerCapsule}>
          <button className={styles.headerTool} onClick={restart} aria-label="새 대화">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></svg>
          </button>
          <button className={styles.headerTool} onClick={() => switchChatMode(chatMode === "voice" ? "text" : "voice")} aria-label={chatMode === "voice" ? "문자 채팅으로 전환" : "음성 채팅으로 전환"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.1 3.8 4.8 6.1c-.8.8-.8 2 0 2.8l2.2 2.2a15.4 15.4 0 0 0 5.9 5.9l2.2 2.2c.8.8 2 .8 2.8 0l2.3-2.3-4-4-2 2c-2.1-1-4.1-3-5.1-5.1l2-2-4-4Z"/></svg>
          </button>
          <button className={styles.headerTool} onClick={() => setSettingsOpen(!settingsOpen)} aria-label="대화 설정">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>
      </header>

      {settingsOpen && <div className={styles.panelBackdrop} onClick={() => setSettingsOpen(false)}>
        <section className={styles.settingsPanel} onClick={(event) => event.stopPropagation()}>
        <button className={styles.panelClose} onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">×</button>
        <div className={styles.settingRow}>
          <label htmlFor="character-live-select">캐릭터</label>
          <select id="character-live-select" value={characterId} onChange={(e)=>switchCharacter(e.target.value)}>
            {characters.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className={styles.settingRow}>
          <label htmlFor="voice-live-select">목소리</label>
          <select id="voice-live-select" value={voiceId || activeCharacter?.voice_id || ""} onChange={(e)=>changeVoice(e.target.value)} disabled={!availableVoices.length}>
            {voiceId && !availableVoices.some((item)=>item.voice_id===voiceId) && <option value={voiceId}>{activeCharacter?.voice_name || "현재 목소리"}</option>}
            {availableVoices.map((item)=><option key={item.voice_id} value={item.voice_id}>{item.name}</option>)}
          </select>
        </div>
        <div className={styles.settingSummary}><span>현재 목소리</span><strong>{activeVoiceName}</strong></div>
        <button className={styles.newChatButton} onClick={() => { restart(); setSettingsOpen(false); }}>이 캐릭터와 새 대화</button>
        </section>
      </div>}

      <section className={styles.chatArea} ref={scrollRef} aria-live="polite">
        <div className={styles.dateChip}>오늘</div>

        {status?.configured && !status.authenticated && <div className={styles.loginCard}>
          <div className={styles.loginAvatar}><CharacterAvatar name={activeName} src={activeAvatar}/></div>
          <strong>도경LIVE</strong>
          <p>접속 코드를 입력하면 대화방이 열려.</p>
          <form onSubmit={login} className={styles.login}>
            <input type="password" autoComplete="current-password" aria-label="접속 코드" placeholder="접속 코드" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="submit">입장</button>
          </form>
        </div>}

        {status && !status.configured && <div className={styles.systemBubble}>서버 접속 코드 설정이 필요해.</div>}
        {status?.authenticated && !status.ready && <div className={styles.systemBubble}>서버 환경변수 설정 필요: {status.missing.join(", ")}</div>}

        {status?.authenticated && showMessages && messages.slice(-40).map((message, index) => message.role === "assistant"
          ? <div key={index} className={styles.assistantRow}>
              <div className={styles.messageAvatar}><CharacterAvatar name={activeName} src={activeAvatar}/></div>
              <div className={styles.messageColumn}>
                <span className={styles.senderName}>{activeName}</span>
                <div className={styles.bubbleLine}>
                  <div className={[styles.bubble, styles.assistantBubble].join(" ")}>{message.content}</div>
                  {message.ts && <time>{formatMessageTime(message.ts)}</time>}
                </div>
              </div>
            </div>
          : <div key={index} className={styles.userRow}>
              <div className={styles.bubbleLine}>
                {message.ts && <time>{formatMessageTime(message.ts)}</time>}
                <div className={styles.userStack}>
                  {message.image && <div className={styles.imageBubble}><img src={message.image.dataUrl} alt="보낸 이미지" /></div>}
                  {message.content && <div className={[styles.bubble, styles.userBubble].join(" ")}>{message.content}</div>}
                </div>
              </div>
            </div>)}

        {status?.authenticated && showMessages && partial && <div className={styles.assistantRow}>
          <div className={styles.messageAvatar}><CharacterAvatar name={activeName} src={activeAvatar}/></div>
          <div className={styles.messageColumn}>
            <span className={styles.senderName}>{activeName}</span>
            <div className={styles.bubbleLine}><div className={[styles.bubble, styles.assistantBubble].join(" ")}>{partial}<span className={styles.cursor}>▋</span></div></div>
          </div>
        </div>}

        {status?.authenticated && !partial && phase === "thinking" && <div className={styles.assistantRow}>
          <div className={styles.messageAvatar}><CharacterAvatar name={activeName} src={activeAvatar}/></div>
          <div className={styles.messageColumn}>
            <span className={styles.senderName}>{activeName}</span>
            <div className={[styles.bubble, styles.assistantBubble, styles.typingBubble].join(" ")}><i></i><i></i><i></i></div>
          </div>
        </div>}

        {status?.authenticated && showMessages && !messages.length && !partial && phase !== "thinking" && <div className={styles.emptyChat}>
          <div className={styles.emptyAvatar}><CharacterAvatar name={activeName} src={activeAvatar}/></div>
          <strong>{activeName}</strong>
          <span>{chatMode === "text" ? "메시지를 보내서 대화를 시작해." : "아래 통화 버튼을 누르면 바로 이야기할 수 있어."}</span>
        </div>}

        {status?.authenticated && chatMode === "voice" && !captions && <div className={styles.systemBubble}>음성 채팅 중 · 자막 꺼짐</div>}
        {error && <div className={styles.errorBubble} role="alert">{error}</div>}
        <div className={styles.chatSpacer} />
      </section>

      {status?.authenticated && chatMode === "text" && <form onSubmit={submitText} className={styles.composer}>
        <div className={styles.composerPill}>
          <input ref={imagePickerRef} className={styles.hiddenFile} type="file" accept="image/*" onChange={(event) => void sendPickedImage(event.target.files?.[0])} />
          <button type="button" className={styles.plusButton} onClick={() => imagePickerRef.current?.click()} aria-label="이미지 보내기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <input aria-label="메시지" placeholder="메시지 입력" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1500} autoComplete="off" />
          {!draft.trim() && <>
            <button type="button" className={styles.composerIcon} aria-label="이모티콘">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 14c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/></svg>
            </button>
            <button type="button" className={styles.composerHash} aria-label="샵">#</button>
            <button type="button" className={styles.composerVoice} onClick={() => switchChatMode("voice")} aria-label="음성 채팅으로 전환">
              <span/><span/><span/><span/><span/>
            </button>
          </>}
          {draft.trim() && <button type="submit" className={styles.sendButton} aria-label="전송">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-5-7-2Z"/></svg>
          </button>}
        </div>
      </form>}

      {status?.authenticated && chatMode === "voice" && <>
        <button className={styles.voiceBackdrop} onClick={closeVoicePanel} aria-label="음성 창 닫기" />
        <section className={styles.voiceDock}>
        <button className={styles.voiceClose} onClick={closeVoicePanel} aria-label="음성 창 닫기">×</button>
        <div className={styles.voiceStatus}>
          <span className={[styles.voiceDot, running.current && phase !== "paused" ? styles.voiceDotOn : ""].filter(Boolean).join(" ")} />
          <div><strong>{running.current && phase !== "paused" ? labels[phase] : "음성 채팅 준비"}</strong><small>{needsTap ? "가운데 버튼을 다시 눌러줘" : running.current ? "말을 멈추면 " + activeName + "이 대답해" : activeVoiceName + " 목소리"}</small></div>
          {latency !== null && <em>{(latency / 1000).toFixed(1)}s</em>}
        </div>
        <div className={styles.voiceActions}>
          <button className={styles.voiceSideButton} onClick={() => { setVoice(!voice); if (voice) stopAudio(); }} aria-pressed={voice}><span>{voice ? "🔊" : "🔇"}</span><small>음성</small></button>
          <button className={[styles.callButton, running.current && phase !== "paused" ? styles.endButton : ""].filter(Boolean).join(" ")} onClick={() => { if (running.current && phase !== "paused") endCall(); else { if (phase === "paused") { closeMic(); running.current = false; } void startCall(); } }} disabled={!status.ready} aria-label={running.current && phase !== "paused" ? "통화 종료" : "통화 시작"}>{running.current && phase !== "paused" ? "■" : "●"}</button>
          <button className={styles.voiceSideButton} onClick={() => setCaptions(!captions)} aria-pressed={captions}><span>▤</span><small>자막</small></button>
        </div>
        {phase === "speaking" && <button className={styles.interruptButton} onClick={interrupt}>말 끊기</button>}
      </section>
      </>}
    </div>
  </main>;
}


"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { measureVisualMotion } from "@/lib/dokyeong/camera-motion";

export type CameraFrame = { mimeType: "image/jpeg"; data: string };
type CapturedFrame = { image: CameraFrame; signature: number[]; capturedAt: number; moved: boolean };
export type CameraMotion = { at: number; changedFraction: number };
type Facing = "user" | "environment";

/**
 * Camera consent is explicit. Only recent, compressed frames live in memory.
 * We do not attach camera frames to the persisted chat or upload them to storage.
 */
export function useCallCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const requestVersion = useRef(0);
  const captured = useRef<CapturedFrame[]>([]);
  const cameraStartedAt = useRef(0);
  const recentMotion = useRef<CameraMotion | null>(null);

  const stop = useCallback(() => {
    requestVersion.current++;
    const old = streamRef.current;
    streamRef.current = null;
    old?.getTracks().forEach(track => track.stop());
    if (previewRef.current) previewRef.current.srcObject = null;
    captured.current = [];
    recentMotion.current = null;
    cameraStartedAt.current = 0;
    setStream(null);
    setBusy(false);
    setError("");
  }, []);

  const start = useCallback(async (nextFacing: Facing = "user") => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 카메라를 사용할 수 없어.");
      return;
    }
    const version = ++requestVersion.current;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    captured.current = [];
    recentMotion.current = null;
    cameraStartedAt.current = 0;
    setStream(null);
    setBusy(true);
    setError("");
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
      });
      if (requestVersion.current !== version) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = next;
      cameraStartedAt.current = Date.now();
      setFacing(nextFacing);
      setStream(next);
      next.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (streamRef.current === next) stop();
      });
    } catch (cause) {
      if (requestVersion.current === version) {
        const name = cause instanceof DOMException ? cause.name : "";
        setError(name === "NotAllowedError" ? "카메라 권한이 거부됐어. 아이폰 설정에서 허용해 줘." : "카메라를 켜지 못했어. 다시 시도해 줘.");
      }
    } finally {
      if (requestVersion.current === version) setBusy(false);
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (streamRef.current) stop();
    else void start(facing);
  }, [stop, start, facing]);

  const flip = useCallback(() => {
    if (!streamRef.current) return;
    void start(facing === "user" ? "environment" : "user");
  }, [start, facing]);

  const capture = useCallback(() => {
    const video = previewRef.current;
    if (!streamRef.current || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !video.videoWidth || !video.videoHeight || document.hidden) return;
    try {
      const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
      if (!base64 || base64.length > 190_000) return;
      const tiny = document.createElement("canvas");
      tiny.width = 24;
      tiny.height = 18;
      const tinyCtx = tiny.getContext("2d", { willReadFrequently: true });
      if (!tinyCtx) return;
      tinyCtx.drawImage(video, 0, 0, tiny.width, tiny.height);
      const pixels = tinyCtx.getImageData(0, 0, tiny.width, tiny.height).data;
      const signature: number[] = [];
      for (let i = 0; i < pixels.length; i += 4) {
        signature.push(pixels[i], pixels[i + 1], pixels[i + 2]);
      }
      const capturedAt = Date.now();
      const previous = captured.current.at(-1);
      const motion = previous && capturedAt - cameraStartedAt.current > 2200
        ? measureVisualMotion(previous.signature, signature)
        : null;
      if (motion?.significant) {
        recentMotion.current = { at: capturedAt, changedFraction: motion.changedFraction };
      }
      captured.current = [...captured.current, {
        image: { mimeType: "image/jpeg" as const, data: base64 },
        signature,
        capturedAt,
        moved: motion?.significant ?? false,
      }].slice(-7);
    } catch {
      // A single unavailable frame must not interrupt a voice call.
    }
  }, []);

  useEffect(() => {
    if (!stream) return;
    const timer = window.setInterval(capture, 850);
    return () => window.clearInterval(timer);
  }, [stream, capture]);

  useEffect(() => {
    const onHidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stop]);

  useEffect(() => () => {
    requestVersion.current++;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    captured.current = [];
  }, []);

  const getFrames = useCallback((): CameraFrame[] => {
    const fresh = captured.current.filter(frame => Date.now() - frame.capturedAt < 7_000);
    if (!fresh.length || !streamRef.current) return [];
    // Three chronological snapshots tell Gemini much more about a gesture
    // than the single latest frame. None are added to chat history.
    if (fresh.length <= 3) return fresh.map(frame => frame.image);
    return [fresh[0].image, fresh[Math.floor((fresh.length - 1) / 2)].image, fresh[fresh.length - 1].image];
  }, []);

  const getMotion = useCallback((): CameraMotion | null => {
    const motion = recentMotion.current;
    return streamRef.current && motion && Date.now() - motion.at < 4_500 ? motion : null;
  }, []);

  return { stream, facing, busy, error, previewRef, stop, toggle, flip, getFrames, getMotion };
}

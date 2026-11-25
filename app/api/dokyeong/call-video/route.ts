import type { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { isCallVideoScene, type CallVideoScene } from "@/lib/dokyeong/call-scenes";
import { serverRpc } from "@/lib/dokyeong/memory";

type LegacyVideoScene = Exclude<CallVideoScene, "complete">;
const pendingVideos = new Map<LegacyVideoScene, Promise<Uint8Array<ArrayBuffer> | null>>();

async function signedCompletedVideo() {
  const serverToken = process.env.CHARACTER_HISTORY_KEY;
  if (!serverToken) return null;
  try {
    const endpoint = "https://ckesuyinmcqemgeemzlh.supabase.co/functions/v1/jiwoo-video-asset";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "x-live-server-token": serverToken },
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string") return null;
    const signed = new URL(data.url);
    if (signed.protocol !== "https:" || signed.hostname !== "ckesuyinmcqemgeemzlh.supabase.co" ||
      !signed.pathname.startsWith("/storage/v1/object/sign/jiwoo-call-videos/jiwoo-complete.mp4")) return null;
    return signed.toString();
  } catch {
    return null;
  }
}

function loadVideo(scene: LegacyVideoScene) {
  const cached = pendingVideos.get(scene);
  if (cached) return cached;
  const rpc = scene === "intimate" ? "live_read_jiwoo_contextual_video" : "live_read_jiwoo_video";
  const pending = serverRpc<string | null>(rpc, {}).catch(() => null).then(value => {
    if (value) return Uint8Array.from(Buffer.from(value, "base64"));
    pendingVideos.delete(scene);
    return null;
  });
  pendingVideos.set(scene, pending);
  return pending;
}

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  const scene = request.nextUrl.searchParams.get("scene") ?? "default";
  if (!isCallVideoScene(scene)) return new Response(null, { status: 404, headers: noStore });
  if (scene === "complete") {
    const url = await signedCompletedVideo();
    if (!url) return new Response(null, { status: 503, headers: noStore });
    return new Response(null, { status: 307, headers: { ...noStore, Location: url, "Cache-Control": "private, no-store" } });
  }
  const video = await loadVideo(scene);
  if (!video) return new Response(null, { status: 503, headers: noStore });

  const length = video.byteLength;
  const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  const range = request.headers.get("range");
  if (!range) return new Response(video, { headers: { ...headers, "Content-Length": String(length) } });

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, length - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start >= length || end < start) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${length}` } });
  }

  return new Response(video.slice(start, end + 1), { status: 206, headers: {
    ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${length}`,
  } });
}

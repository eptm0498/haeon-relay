import type { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { isCallVideoScene, type CallVideoScene } from "@/lib/dokyeong/call-scenes";
import { serverRpc } from "@/lib/dokyeong/memory";

const pendingVideos = new Map<CallVideoScene, Promise<Uint8Array<ArrayBuffer> | null>>();

function loadVideo(scene: CallVideoScene) {
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

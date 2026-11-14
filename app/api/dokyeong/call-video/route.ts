import type { NextRequest } from "next/server";
import { authenticated, noStore, unauthorized } from "@/lib/dokyeong/auth";
import { serverRpc } from "@/lib/dokyeong/memory";

let pendingVideo: Promise<Uint8Array<ArrayBuffer> | null> | undefined;
function loadVideo() {
  if (!pendingVideo) {
    pendingVideo = serverRpc<string | null>("live_read_jiwoo_video", {}).then(value => {
      if (!value) {
        pendingVideo = undefined;
        return null;
      }
      return Uint8Array.from(Buffer.from(value, "base64"));
    }).catch(() => {
      pendingVideo = undefined;
      return null;
    });
  }
  return pendingVideo;
}

export async function GET(request: NextRequest) {
  if (!authenticated(request)) return unauthorized();
  const video = await loadVideo();
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

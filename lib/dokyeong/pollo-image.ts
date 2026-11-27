import { setTimeout as delay } from "node:timers/promises";

const base = "https://pollo.ai/api/platform/v1";
export const POLLO_IMAGE_MODEL = "pollojourney-v8-2-image";
export class PolloImageError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = "PolloImageError"; }
}
const rejected = (data: unknown) => /moderation|safety|nsfw|content.?policy|content.?filter|blocked|prohibited|inappropriate|explicit|pornograph|sexual|adult.?content|色情|审核|违禁|생성.?제한/i.test(JSON.stringify(data));

async function json(path: string, key: string, signal: AbortSignal, body?: object) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET", headers: { "x-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.code && data.code !== "SUCCESS" && !data.taskId && !data.generations) {
    if (rejected(data)) throw new PolloImageError("rejected");
    throw new PolloImageError(response.status === 401 || response.status === 403 ? "authentication" : response.status === 402 ? "credits" : response.status === 429 ? "rate_limit" : "upstream");
  }
  const result = data?.code === "SUCCESS" && data.data ? data.data : data;
  if (result?.status === "failed" && rejected(result)) throw new PolloImageError("rejected");
  return result;
}

export async function generatePolloImage(input: { prompt: string; images: string[]; portrait: boolean; signal: AbortSignal }) {
  const key = process.env.POLLO_API_KEY;
  if (!key || !input.prompt.trim() || input.prompt.length > 1000) throw new PolloImageError("unsupported");
  // One submission only. Never resubmit on a lost response or a transient polling failure.
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(80000)]);
  const task = await json(`/generation/pollo-ai/${POLLO_IMAGE_MODEL}/image`, key, signal, { input: {
    prompt: input.prompt, ...(input.images.length ? { images: input.images } : {}), aspectRatio: input.portrait ? "9:16" : "1:1", resolution: "1K",
  } });
  if (typeof task?.taskId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(task.taskId)) throw new PolloImageError("upstream");
  for (;;) {
    const status = await json(`/generation/${encodeURIComponent(task.taskId)}/status`, key, signal);
    const generations = Array.isArray(status?.generations) ? status.generations : [];
    const failure = generations.find((g: { status?: string }) => g.status === "failed");
    if (failure || status?.status === "failed") throw new PolloImageError(rejected(failure || status) ? "rejected" : "upstream");
    const done = generations.find((g: { status?: string; mediaType?: string }) => ["succeed", "succeeded"].includes(g.status || "") && g.mediaType === "image");
    if (done) {
      const url = new URL(done.url);
      // The provider's output URL is data, never an arbitrary authenticated request.
      // Credentials must never follow it to a CDN, and redirects are rejected.
      if (url.protocol !== "https:" || url.username || url.password || !/\.(?:pollo\.ai|hix\.ai)$/.test(url.hostname)) throw new PolloImageError("output");
      const response = await fetch(url, { signal: AbortSignal.any([input.signal, AbortSignal.timeout(15000)]), redirect: "error" });
      if (!response.ok || !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get("content-type") || "") || Number(response.headers.get("content-length")) > 12000000) throw new PolloImageError("output");
      const reader = response.body?.getReader(); if (!reader) throw new PolloImageError("output");
      const parts: Uint8Array[] = []; let length = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 12000000) { await reader.cancel(); throw new PolloImageError("output"); } parts.push(value); }
      if (!length) throw new PolloImageError("output");
      return { encoded: Buffer.concat(parts).toString("base64"), model: `pollo/${POLLO_IMAGE_MODEL}` };
    }
    if (!generations.length && !["waiting", "pending", "processing"].includes(status?.status || "")) throw new PolloImageError("upstream");
    await delay(2000, undefined, { signal });
  }
}

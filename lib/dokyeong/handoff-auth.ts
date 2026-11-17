import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { configured, noStore } from "./auth";

export const issuer = "https://haeon-relay.vercel.app";
export const oauthPath = "/api/dokyeong/handoff/oauth";
export const resource = issuer + "/api/dokyeong/handoff/mcp";
export const resourceMetadata = issuer + "/.well-known/oauth-protected-resource/api/dokyeong/handoff/mcp";
export const scope = "jiwoo:continue";
export const clientId = "https://chatgpt.com/oauth/client.json";
export const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
export const accessSeconds = 30 * 24 * 60 * 60;

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const opaqueToken = () => randomBytes(32).toString("base64url");

function signature(payload: string) {
  if (!configured() || !process.env.CHARACTER_HISTORY_KEY) throw new Error("Handoff authorization unavailable");
  return createHmac("sha256", process.env.CHARACTER_HISTORY_KEY)
    .update(JSON.stringify([resource, scope, process.env.DOKYEONG_ACCESS_CODE?.trim(), payload])).digest("hex");
}

export function newHandoffAccessToken() {
  const payload = `${opaqueToken()}.${Math.floor(Date.now() / 1000) + accessSeconds}`;
  return `${payload}.${signature(payload)}`;
}

export function hasHandoffAccess(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43}\.[0-9]{10})\.([a-f0-9]{64})$/i);
  if (!match || Number(match[1].split(".")[1]) <= Math.floor(Date.now() / 1000)) return false;
  try {
    return timingSafeEqual(Buffer.from(signature(match[1])), Buffer.from(match[2].toLowerCase()));
  } catch { return false; }
}

export async function handoffForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return null;
  const raw = await request.text();
  return raw.length <= 12_000 ? new URLSearchParams(raw) : null;
}

export const oauthResponse = (value: object, status = 200) => Response.json(value, { status, headers: noStore });

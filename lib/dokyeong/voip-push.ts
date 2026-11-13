import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";
import { serverRpc } from "./memory";

type Device = { token: string; environment: "development" | "production" };
type VoipJob = Device & { id: string; callId: string; expiresAt: number };
type Config = { team: string; keyId: string; key: string; bundle: string };

function configuration(): Config | null {
  const { LIVE_APNS_TEAM_ID: team, LIVE_APNS_KEY_ID: keyId, LIVE_APNS_KEY: key, LIVE_APNS_BUNDLE_ID: bundle } = process.env;
  return team && keyId && key && bundle ? { team, keyId, key, bundle } : null;
}

export const voipPushConfigured = () => configuration() !== null;

let cachedAuth: { token: string; issuedAt: number; keyId: string } | undefined;
function authorization(config: Config) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAuth?.keyId === config.keyId && now - cachedAuth.issuedAt < 50 * 60) return cachedAuth.token;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = encode({ alg: "ES256", kid: config.keyId }) + "." + encode({ iss: config.team, iat: now });
  const key = createPrivateKey(config.key.replace(/\\n/g, "\n"));
  const token = input + "." + sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cachedAuth = { token, issuedAt: now, keyId: config.keyId };
  return token;
}

export function voipHeaders(bundle: string, token: string, expiresAt: number, now = Date.now()) {
  return {
    ":method": "POST",
    ":path": "/3/device/" + token,
    "apns-push-type": "voip",
    "apns-topic": bundle + ".voip",
    "apns-priority": "10",
    "apns-expiration": String(Math.floor(Math.min(expiresAt, now + 10_000) / 1000)),
    "content-type": "application/json",
  };
}

async function send(job: VoipJob, config: Config, auth: string) {
  const host = job.environment === "development" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const connection = connect("https://" + host);
  try {
    return await new Promise<{ status: number; reason?: string }>((resolve, reject) => {
      connection.once("error", reject);
      const stream = connection.request({ ...voipHeaders(config.bundle, job.token, job.expiresAt), authorization: "bearer " + auth });
      let status = 0;
      let raw = "";
      stream.setTimeout(8000, () => { stream.close(); reject(Error("APNs timeout")); });
      stream.setEncoding("utf8");
      stream.on("response", headers => { status = Number(headers[":status"]); });
      stream.on("data", chunk => { raw += chunk; });
      stream.on("error", reject);
      stream.on("end", () => {
        try { resolve({ status, reason: JSON.parse(raw).reason }); } catch { resolve({ status }); }
      });
      stream.end(JSON.stringify({ aps: {}, callId: job.callId, expiresAt: job.expiresAt }));
    });
  } finally {
    connection.destroy();
  }
}

export async function deliverVoipCalls() {
  const config = configuration();
  if (!config) return 0;
  const auth = authorization(config);
  const jobs = await serverRpc<VoipJob[]>("live_voip_work", { action: "claim" });
  const results = await Promise.all(jobs.map(async job => {
    let result: Awaited<ReturnType<typeof send>> = { status: 0 };
    if (job.expiresAt > Date.now()) {
      try { result = await send(job, config, auth); } catch { /* Release for retry while the call is ringing. */ }
    }
    const delivered = result.status === 200;
    const gone = result.status === 410;
    const retry = result.status === 0 || result.status === 429 || result.status >= 500;
    if (!delivered && result.status) console.warn("LIVE_VOIP_APNS_REJECTED", { status: result.status, reason: result.reason });
    await serverRpc("live_voip_work", {
      action: "ack", job_id: job.id, complete: delivered || !retry || job.expiresAt <= Date.now(), gone,
    });
    return delivered ? 1 : 0;
  }));
  return results.reduce<number>((sum, value) => sum + value, 0);
}

export async function deliverIncomingCallNotifications() {
  const { deliverPushJobs } = await import("./push");
  await Promise.allSettled([deliverPushJobs(), deliverVoipCalls()]).then(results => {
    if (results.some(result => result.status === "rejected")) console.warn("LIVE_INCOMING_CALL_PUSH_RETRY");
  });
}

import { randomBytes } from "node:crypto";
import { digest } from "./handoff-auth";
import { serverRpc } from "./memory";

export async function issuePairingCode() {
  const raw = randomBytes(8).toString("hex");
  const issued = await serverRpc<boolean>("live_jiwoo_pairing_code", { pairing_digest: digest(raw) });
  if (!issued) throw new Error("Pairing code unavailable");
  return raw.toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

export function redeemPairingCode(input: string, code: string, challenge: string) {
  const raw = input.replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(raw)) return false;
  return serverRpc<boolean>("live_jiwoo_pairing_code", {
    pairing_digest: digest(raw), authorization_digest: digest(code), pkce_challenge: challenge,
  });
}

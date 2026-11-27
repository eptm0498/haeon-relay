import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReferenceImages } from "./reference-images";

type ReferenceGrant = { characterId: string; kind: "face" | "body" | "avatar" | "source" | "board"; index: number; expires: number; messageId?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sign = (payload: string) => createHmac("sha256", process.env.CHARACTER_HISTORY_KEY || "").update("image-reference-v1:" + payload).digest("hex");

export function imageReferenceUrls(characterId: string | undefined, references: ReferenceImages, avatar: string | null | undefined, sourceMessageId?: string, board = false) {
  const slots: { kind: ReferenceGrant["kind"]; index: number; messageId?: string }[] = [
    ...references.face.map((_, index) => ({ kind: "face" as const, index })), ...references.body.map((_, index) => ({ kind: "body" as const, index })),
  ];
  if (!slots.length && avatar) slots.push({ kind: "avatar", index: 0 });
  if (sourceMessageId) slots.push({ kind: "source", index: 0, messageId: sourceMessageId });
  if (!slots.length) return [];
  if (!characterId || !uuid.test(characterId) || !process.env.CHARACTER_HISTORY_KEY) throw Error("Reference access unavailable");
  const grants = board && slots.length > 1 ? [{ kind: "board" as const, index: 0, ...(sourceMessageId ? { messageId: sourceMessageId } : {}) }] : slots;
  return grants.map(slot => {
    const payload = Buffer.from(JSON.stringify({ ...slot, characterId, expires: Date.now() + 10 * 60000 })).toString("base64url");
    return `https://haeon-relay.vercel.app/api/dokyeong/image-reference/${payload}.${sign(payload)}`;
  });
}

export function verifyImageReference(token: string, now = Date.now()): ReferenceGrant | null {
  if (!process.env.CHARACTER_HISTORY_KEY || token.length > 1200) return null;
  const [payload, signature, extra] = token.split(".");
  if (extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload || "") || !/^[a-f0-9]{64}$/.test(signature || "")) return null;
  if (!timingSafeEqual(Buffer.from(sign(payload)), Buffer.from(signature))) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!uuid.test(grant.characterId) || !["face", "body", "avatar", "source", "board"].includes(grant.kind) || !Number.isInteger(grant.index) || grant.index < 0 || grant.index > 1 ||
        !Number.isSafeInteger(grant.expires) || grant.expires <= now || grant.expires > now + 10 * 60000 ||
        ((grant.kind === "source" || grant.messageId !== undefined) && (typeof grant.messageId !== "string" || !/^[A-Za-z0-9:_-]{1,120}$/.test(grant.messageId)))) return null;
    return grant;
  } catch { return null; }
}

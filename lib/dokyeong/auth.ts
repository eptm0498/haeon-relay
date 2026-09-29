import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

export const cookieName = "dokyeong_live_session";
const secret = () => process.env.DOKYEONG_ACCESS_CODE?.trim() || "";
export const configured = () => secret().length >= 12;
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("hex");

export function authenticated(request: NextRequest) {
  if (!configured()) return false;
  const value = request.cookies.get(cookieName)?.value || "";
  const [expiry, signature] = value.split(".");
  if (!/^\d{13}$/.test(expiry || "") || Number(expiry) < Date.now() || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  return timingSafeEqual(Buffer.from(sign(expiry)), Buffer.from(signature));
}

export function validAccessCode(input: string) {
  if (!configured() || input.length > 200) return false;
  const expected = Buffer.from(sign("access"));
  const actual = Buffer.from(createHmac("sha256", input).update("access").digest("hex"));
  return timingSafeEqual(expected, actual);
}

export function newSession() {
  const expiry = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return { value: `${expiry}.${sign(expiry)}`, maxAge: 7 * 24 * 60 * 60 };
}

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === request.headers.get("host"); } catch { return false; }
}

export const noStore = { "Cache-Control": "no-store" };
export const unauthorized = () => Response.json({ error: "다시 접속해 줘." }, { status: 401, headers: noStore });

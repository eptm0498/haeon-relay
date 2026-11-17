import { createHash } from "node:crypto";
import { noStore, validAccessCode } from "@/lib/dokyeong/auth";
import {
  accessSeconds, clientId, digest, handoffForm, issuer, newHandoffAccessToken, oauthPath, oauthResponse,
  opaqueToken, redirectUri, resource, scope,
} from "@/lib/dokyeong/handoff-auth";
import { handoffRpc } from "@/lib/dokyeong/jiwoo-handoff";

type Params = { params: Promise<{ operation: string }> };

function requestFields(fields: URLSearchParams) {
  const state = fields.get("state") ?? "";
  const challenge = fields.get("code_challenge") ?? "";
  if (fields.get("client_id") !== clientId || fields.get("redirect_uri") !== redirectUri ||
    fields.get("resource") !== resource || fields.get("response_type") !== "code" ||
    (fields.get("scope") ?? scope) !== scope || fields.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !state || state.length > 2048) return null;
  return { state, challenge };
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function authorizePage(state: string, challenge: string, invalid = false) {
  const fields = {
    state, code_challenge: challenge, client_id: clientId, redirect_uri: redirectUri,
    resource, response_type: "code", scope, code_challenge_method: "S256",
  };
  const inputs = Object.entries(fields).map(([name,value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`).join("");
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>지우 이어가기 연결</title><style>body{font:17px system-ui,sans-serif;background:#171717;color:#fff;margin:0;padding:24px}main{max-width:440px;margin:12vh auto}label{display:grid;gap:8px}input,button{font:inherit;padding:12px;border-radius:8px}button{margin-top:16px;background:#fee500;color:#181818;border:0;cursor:pointer}p{line-height:1.6}</style><main><h1>지우 이어가기 연결</h1><p>ChatGPT와 캐릭터라이브가 지우의 이어가기 메모를 저장하고 불러올 수 있게 연결해.</p><form method="post" action="${oauthPath}/authorize">${inputs}<label>캐릭터라이브 접속 코드<input name="access_code" type="password" autocomplete="current-password" maxlength="200" required></label>${invalid ? '<p role="alert">접속 코드가 맞지 않아.</p>' : ''}<button type="submit">연결 허용</button></form></main></html>`, {
    status: invalid ? 401 : 200,
    headers: { ...noStore, "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" },
  });
}

export async function GET(request: Request, { params }: Params) {
  if ((await params).operation !== "authorize") return oauthResponse({ error: "invalid_request" }, 400);
  const fields = requestFields(new URL(request.url).searchParams);
  return fields ? authorizePage(fields.state, fields.challenge) : oauthResponse({ error: "invalid_request" }, 400);
}

export async function POST(request: Request, { params }: Params) {
  const operation = (await params).operation;
  const form = await handoffForm(request);
  if (!form) return oauthResponse({ error: "invalid_request" }, 400);
  try {
    if (operation === "authorize") {
      if (request.headers.get("origin") !== issuer) return oauthResponse({ error: "invalid_request" }, 403);
      const fields = requestFields(form);
      if (!fields) return oauthResponse({ error: "invalid_request" }, 400);
      if (!validAccessCode(form.get("access_code") ?? "")) return authorizePage(fields.state, fields.challenge, true);
      const code = opaqueToken();
      const saved = await handoffRpc<boolean>("issue_code", { digest: digest(code), challenge: fields.challenge });
      if (!saved) return oauthResponse({ error: "server_error" }, 503);
      const callback = new URL(redirectUri);
      callback.search = new URLSearchParams({ code, state: fields.state, iss: issuer }).toString();
      return new Response(null, { status: 303, headers: { ...noStore, Location: callback.href, "Referrer-Policy": "no-referrer" } });
    }
    if (operation !== "token" || form.get("client_id") !== clientId || form.get("redirect_uri") !== redirectUri ||
      form.get("resource") !== resource || form.get("grant_type") !== "authorization_code") {
      return oauthResponse({ error: "invalid_request" }, 400);
    }
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return oauthResponse({ error: "invalid_grant" }, 400);
    }
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!await handoffRpc<boolean>("consume_code", { digest: digest(code), challenge })) {
      return oauthResponse({ error: "invalid_grant" }, 400);
    }
    return oauthResponse({ access_token: newHandoffAccessToken(), token_type: "Bearer", expires_in: accessSeconds, scope });
  } catch {
    return oauthResponse({ error: "server_error" }, 503);
  }
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-admin-pin",
  },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({});
  if (req.method !== "POST") return json({ error: "허용되지 않은 요청이야." }, 405);
  try {
    const auth = await fetch(url + "/functions/v1/cash-board", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-pin": req.headers.get("x-admin-pin") ?? "",
      },
      body: JSON.stringify({ action: "bootstrap" }),
    });
    if (!auth.ok) return json({ error: "관리자 인증을 확인해줘." }, 401);
    const body = await req.json();
    const nickname = String(body.nickname ?? "").trim();
    const pick = Number(body.pick);
    if (!nickname || !Number.isInteger(pick) || pick < 1 || pick > 5) {
      return json({ error: "사용자와 말을 선택해줘." }, 400);
    }
    const { data, error } = await db.rpc("cash_horse_race", {
      p_nickname: nickname,
      p_pick: pick,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, ...data });
  } catch {
    return json({ error: "경마 게임을 처리하지 못했어." }, 500);
  }
});

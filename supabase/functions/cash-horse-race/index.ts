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
    if (body.action === "settings_load") {
      const { data, error } = await db.from("cash_horse_settings")
        .select("probabilities,multipliers").eq("id", 1).single();
      if (error || !data) return json({ error: "경마 설정을 불러오지 못했어." }, 500);
      return json({ ok: true, ...data });
    }
    if (body.action === "settings_save") {
      const probabilities = body.probabilities;
      const multipliers = body.multipliers;
      if (!Array.isArray(probabilities) || probabilities.length !== 5 ||
          probabilities.some((value: unknown) => !Number.isInteger(value) || value < 0 || value > 100) ||
          probabilities.reduce((total: number, value: number) => total + value, 0) !== 100 ||
          !Array.isArray(multipliers) || multipliers.length !== 5 ||
          multipliers.some((value: unknown) => !Number.isInteger(value) || value < 1 || value > 100000)) {
        return json({ error: "우승 확률 합계는 100%, 배율은 0.01~1000.00배로 입력해줘." }, 400);
      }
      const { data, error } = await db.from("cash_horse_settings")
        .update({ probabilities, multipliers, updated_at: new Date().toISOString() })
        .eq("id", 1).select("probabilities,multipliers").single();
      if (error || !data) return json({ error: "경마 설정을 저장하지 못했어." }, 500);
      return json({ ok: true, ...data });
    }
    const nickname = String(body.nickname ?? "").trim();
    const pick = Number(body.pick);
    const wager = Number(body.wager);
    if (!nickname || !Number.isInteger(pick) || pick < 1 || pick > 5 ||
        !Number.isSafeInteger(wager) || wager < 100 || wager > 1000000000000 || wager % 100 !== 0) {
      return json({ error: "사용자, 말과 판돈을 확인해줘. 판돈은 100캐시 단위야." }, 400);
    }
    const { data, error } = await db.rpc("cash_horse_race_wager", {
      p_nickname: nickname,
      p_pick: pick,
      p_wager: wager,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, ...data });
  } catch {
    return json({ error: "경마 게임을 처리하지 못했어." }, 500);
  }
});

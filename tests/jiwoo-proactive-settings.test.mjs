import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as prefs from "../lib/dokyeong/jiwoo-preferences.ts";

const source = readFileSync(new URL("../app/api/dokyeong/jiwoo-settings/proactive/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function fixture({ authenticated = true, sameOrigin = true, conflict = false } = {}) {
  const calls = [];
  const exports = {};
  const mocks = {
    "@/lib/dokyeong/auth": { authenticated: () => authenticated, sameOrigin: () => sameOrigin,
      noStore: {}, unauthorized: () => new Response(null, { status: 401 }) },
    "@/lib/dokyeong/jiwoo-preferences": prefs,
    "@/lib/dokyeong/settings": { rpc: async (functionName, data) => {
      calls.push({ functionName, data });
      if (conflict) throw new Error("VERSION_CONFLICT");
      return { ...prefs.defaultJiwooPreferences, ...data.settings, version: 4 };
    } },
  };
  vm.runInNewContext(code, { exports, require: name => mocks[name], Response, Error, process: { env: {} } });
  return { ...exports, calls };
}

function request(body) {
  return new Request("https://example.com/api/dokyeong/jiwoo-settings/proactive", {
    method: "PUT", body: JSON.stringify(body),
  });
}

const settings = { proactiveTexts: false, proactiveDailyStarts: 3, proactiveSeriesMessages: 2, version: 3 };

test("in-app settings return existing defaults without exposing character instructions or schedules", async () => {
  const response = await fixture().GET(new Request("https://example.com"));
  assert.deepEqual(await response.json(), {
    proactiveTexts: true, proactiveDailyStarts: 10, proactiveSeriesMessages: 5, version: 4,
  });
});

test("saving only updates the three proactive fields and rejects stale settings", async () => {
  const app = fixture();
  const response = await app.PUT(request({ ...settings, workHours: [], scheduleNotes: "do not change" }));
  assert.deepEqual(await response.json(), { ...settings, version: 4 });
  assert.deepEqual(app.calls[0].data.settings, {
    proactiveTexts: false, proactiveDailyStarts: 3, proactiveSeriesMessages: 2,
  });
  assert.equal(app.calls[0].data.expected_version, 3);
  assert.equal((await fixture({ conflict: true }).PUT(request(settings))).status, 409);
});

test("authentication, request origin, and both prior caps are enforced", async () => {
  assert.equal((await fixture({ authenticated: false }).PUT(request(settings))).status, 401);
  assert.equal((await fixture({ sameOrigin: false }).PUT(request(settings))).status, 403);
  const app = fixture();
  for (const fields of [{ proactiveDailyStarts: 11 }, { proactiveSeriesMessages: 6 },
    { proactiveDailyStarts: "3" }, { proactiveTexts: "false" }, { version: -1 }]) {
    assert.equal((await app.PUT(request({ ...settings, ...fields }))).status, 400);
  }
  assert.equal(app.calls.length, 0);
});

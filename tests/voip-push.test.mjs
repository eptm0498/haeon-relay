import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(environment = {}, jobs = []) {
  const exports = {}, requested = [], work = [];
  const fakeConnection = () => ({
    once() {}, destroy() {},
    request(headers) {
      const handlers = {};
      const request = {
        setTimeout() {}, setEncoding() {}, on(event, listener) { handlers[event] = listener; },
        end(payload) {
          requested.push({ headers, payload: JSON.parse(payload) });
          handlers.response({ ":status": 200 });
          handlers.end();
        },
      };
      return request;
    },
  });
  const mocks = {
    "node:crypto": { createPrivateKey: () => "", sign: () => Buffer.from("test") },
    "node:http2": { connect(host) { requested.push(host); return fakeConnection(); } },
    "./memory": { async serverRpc(_name, body) { work.push(body); return body.action === "claim" ? jobs : {}; } },
  };
  const source = readFileSync(new URL("../lib/dokyeong/voip-push.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; },
    Buffer, console, process: { env: environment },
  });
  return { api: exports, requested, work };
}

test("VoIP delivery stays disabled until Apple signing configuration exists", async () => {
  const { api, requested, work } = fixture();
  assert.equal(await api.deliverVoipCalls(), 0);
  assert.deepEqual(requested, []);
  assert.deepEqual(work, []);
});

test("APNs gets an expiring, call-only payload through the registered environment", async () => {
  const environment = { LIVE_APNS_TEAM_ID: "team", LIVE_APNS_KEY_ID: "key", LIVE_APNS_KEY: "fixture", LIVE_APNS_BUNDLE_ID: "app.test.live" };
  const expiresAt = Date.now() + 20_000;
  const job = { token: "test-token", callId: "test-call", id: "job", expiresAt, environment: "development" };
  const { api, requested, work } = fixture(environment, [job]);
  assert.equal(await api.deliverVoipCalls(), 1);
  assert.equal(requested[0], "https://api.sandbox.push.apple.com");
  const { headers, payload } = requested[1];
  assert.equal(headers["apns-topic"], "app.test.live.voip");
  assert.equal(headers["apns-push-type"], "voip");
  assert.equal(headers["apns-priority"], "10");
  assert.ok(Number(headers["apns-expiration"]) * 1000 < expiresAt);
  assert.equal(payload.callId, job.callId);
  assert.deepEqual(Object.keys(payload).sort(), ["aps", "callId", "expiresAt"]);
  assert.equal(work[1].complete, true);
});

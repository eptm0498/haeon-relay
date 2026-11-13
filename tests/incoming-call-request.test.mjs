import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { requestsIncomingCall } from "../lib/dokyeong/incoming-call-intent.ts";
import { STANDALONE_JIWOO_ID } from "../lib/dokyeong/character-modes.ts";

test("direct requests ask Jiwoo to ring now and reported or future requests do not", () => {
  for (const text of [
    "지우야 지금 전화 걸어줘", "나한테 전화해줘", "지금 전화할래?", "전화 좀 걸어줄래?",
    "전화 걸어줄 수 있어?", "나 지금 통화하고 싶은데 전화 한 번만 걸어봐", "통화하자",
  ]) assert.equal(requestsIncomingCall(text), true, text);
  for (const text of [
    "전화 걸어달라고 해도 한다고 하는데 전화가 안 걸리는데?", "“전화 걸어줘”라고 말하면 돼?",
    "전화 걸어줘 하면 돼?", "전화 걸어줘도 돼?", "전화 걸어야 해?", "내가 전화 걸게",
    "지금은 전화 걸지 마", "10분 뒤에 전화 걸어줘", "내일 8시에 전화 걸어줘", "전화하는 방법 알려줘",
  ]) assert.equal(requestsIncomingCall(text), false, text);
});

function routeFixture() {
  const rpcCalls = [], tasks = [], pushCalls = [];
  const mocks = {
    "node:crypto": {},
    "next/server": { after: task => tasks.push(task) },
    "@/lib/dokyeong/auth": { authenticated: () => true, sameOrigin: () => true, noStore: {} },
    "@/lib/dokyeong/settings": { rpc: async (name, body) => {
      rpcCalls.push({ name, body });
      const saved = { character_id: STANDALONE_JIWOO_ID, epoch: body.expected_epoch, messages: body.incoming };
      if (name === "live_request_jiwoo_call") return { ...saved, incoming_call_id: "calling" };
      return { ...saved, reply_job_id: "reply" };
    } },
    "@/lib/dokyeong/reply-jobs": { runReplyWorker: async id => pushCalls.push(id) },
    "@/lib/dokyeong/voip-push": { deliverIncomingCallNotifications: async () => pushCalls.push("push") },
    "@/lib/dokyeong/push": { deliverPushJobs: async () => pushCalls.push("push") },
    "@/lib/dokyeong/image-jobs": {},
    "@/lib/dokyeong/character-modes": { isStandaloneJiwoo: id => id === STANDALONE_JIWOO_ID },
    "@/lib/dokyeong/incoming-call-intent": { requestsIncomingCall },
    "@/lib/dokyeong/reply-timing": { urgentMessage: () => false },
    "@/lib/dokyeong/memory": { updateMemory: async () => {} },
  };
  const exports = {};
  const source = readFileSync(new URL("../app/api/dokyeong/history/route.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => { assert.ok(mocks[name], name); return mocks[name]; }, Response, process: { env: {} },
  });
  return { post: exports.POST, rpcCalls, tasks, pushCalls };
}

test("Jiwoo's text request saves and rings in one RPC without generating a text promise", async () => {
  for (const [content, rpc, task] of [
    ["전화 걸어줘", "live_request_jiwoo_call", "push"],
    ["전화 걸어달라고 했는데 왜 안 와?", "live_append_jiwoo_text", "reply"],
  ]) {
    const fixture = routeFixture();
    const id = "aabbccdd-1234-4321-aaaa-abcdef123456";
    const epoch = "aabbccdd-1234-4321-aaaa-abcdef123457";
    const response = await fixture.post(new Request("https://app.test/api/dokyeong/history", {
      method: "POST", body: JSON.stringify({ action: "append", characterId: STANDALONE_JIWOO_ID, epoch, replyTo: id,
        messages: [{ id, role: "user", ts: 1, content }] }),
    }));
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.messages[0].content, content);
    assert.equal(saved.incomingCallId, task === "push" ? "calling" : undefined);
    assert.deepEqual(fixture.rpcCalls.map(call => call.name), [rpc]);
    await Promise.all(fixture.tasks.map(run => run()));
    assert.deepEqual(fixture.pushCalls, [task]);
  }
});

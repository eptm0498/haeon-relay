import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { NextRequest } from "next/server.js";
import ts from "typescript";
import { callScenePrompt, callSceneReader, isCallVideoScene } from "../lib/dokyeong/call-scenes.ts";

test("video selection and photo selection can share a streamed header without reaching the dialogue", () => {
  const photos = [{ id: "album-id", situation: "쉬는 중" }];
  const selections = [];
  let dialogue = "";
  const reader = callSceneReader(photos, id => selections.push(id), text => { dialogue += text; }, video => selections.push(video));
  for (const chunk of [" ", "[CALL_", "SCENE:1;VIDEO:", "intimate]", "\n여기 있어."]) reader.push(chunk);
  reader.finish();
  assert.deepEqual(selections, ["album-id", "intimate"]);
  assert.equal(dialogue.trim(), "여기 있어.");
});

test("video selection works without photos and a legacy or invalid marker never selects the alternate clip", () => {
  assert.match(callScenePrompt([], null, true, true), /\[CALL_SCENE:번호;VIDEO:intimate\]/);
  assert.doesNotMatch(callScenePrompt([{ id: "photo", situation: "일상" }], null, true), /VIDEO:/);
  for (const [header, expected] of [["0;VIDEO:default", ["default"]], ["0", []], ["0;VIDEO:unknown", []], ["0;VIDEO:intimate;VIDEO:default", []]]) {
    const selections = [];
    let dialogue = "";
    const reader = callSceneReader([], () => {}, text => { dialogue += text; }, video => selections.push(video));
    reader.push(`[CALL_SCENE:${header}]\n오늘 뭐 했어?`);
    reader.finish();
    assert.deepEqual(selections, expected);
    assert.equal(dialogue, "오늘 뭐 했어?");
  }
});

test("both clips require a session and support independent byte ranges and retries", async () => {
  const source = readFileSync(new URL("../app/api/dokyeong/call-video/route.ts", import.meta.url), "utf8");
  const rpcCalls = [];
  const exports = {};
  const mocks = {
    "@/lib/dokyeong/auth": { authenticated: req => req.cookies.has("fixture"), noStore: {}, unauthorized: () => new Response(null, { status: 401 }) },
    "@/lib/dokyeong/call-scenes": { isCallVideoScene },
    "@/lib/dokyeong/memory": { serverRpc: async name => {
      rpcCalls.push(name);
      if (name === "live_read_jiwoo_video") return Buffer.from("original").toString("base64");
      if (rpcCalls.length === 2) return null;
      return Buffer.from("alternate").toString("base64");
    } },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => mocks[name], Buffer, Response,
  });
  const request = (query = "", range, signedIn = true) => exports.GET(new NextRequest(`https://app.test/api/dokyeong/call-video${query}`, {
    headers: { ...(range ? { range } : {}), ...(signedIn ? { cookie: "fixture=1" } : {}) },
  }));
  for (const query of ["", "?scene=intimate"]) assert.equal((await request(query, undefined, false)).status, 401);
  assert.equal((await request("?scene=invalid")).status, 404);
  assert.deepEqual(rpcCalls, []);
  assert.equal(await (await request()).text(), "original");
  assert.equal((await request("?scene=intimate")).status, 503);
  const alternate = await request("?scene=intimate", "bytes=0-1");
  assert.equal(alternate.status, 206);
  assert.equal(alternate.headers.get("content-range"), "bytes 0-1/9");
  assert.equal(await alternate.text(), "al");
  assert.equal(await (await request("?scene=intimate")).text(), "alternate");
  assert.equal((await request("", "bytes=99-")).status, 416);
  assert.equal(await (await request("", "bytes=-3")).text(), "nal");
  assert.deepEqual(rpcCalls, ["live_read_jiwoo_video", "live_read_jiwoo_contextual_video", "live_read_jiwoo_contextual_video"]);
});

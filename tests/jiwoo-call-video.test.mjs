import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { NextRequest } from "next/server.js";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { isCallVideoScene } from "../lib/dokyeong/call-scenes.ts";

test("the call controls switch clips on demand, preserve the choice across replies, and recover from a failed clip", () => {
  const source = readFileSync(new URL("../app/dokyeong-live/CallStage.tsx", import.meta.url), "utf8");
  const exports = {};
  const state = [];
  let cursor = 0;
  const mocks = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState: initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = value; }];
      },
      useRef: () => ({ current: null }), useEffect: () => {},
    },
    "lucide-react": {}, "./CharacterAvatar": { default: () => null }, "./live.module.css": { default: {} },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => mocks[name] });

  let videoOn = true;
  function* elements(node) {
    if (!node?.props) return;
    yield node;
    for (const child of [node.props.children].flat(Infinity)) yield* elements(child);
  }
  const render = status => {
    cursor = 0;
    return [...elements(exports.default({ name: "지우", videoSource: "/base", alternateVideoSource: "/attached", status,
      videoOn, onVideoChange: on => { videoOn = on; } }))];
  };
  const button = (nodes, label) => nodes.find(node => node.type === "button" &&
    (node.props.children === label || node.props["aria-label"] === label)).props;
  const video = nodes => nodes.find(node => node.type === "video")?.props;

  assert.equal(video(render()).src, "/base");
  button(render(), "첨부 영상").onClick();
  const duringReply = render("말하는 중");
  assert.equal(button(duringReply, "첨부 영상")["aria-pressed"], true);
  assert.equal(video(duringReply).src, "/attached");
  assert.equal(video(duringReply).muted, true);
  button(render(), "기본 영상").onClick();
  assert.equal(video(render()).src, "/base");
  button(render(), "첨부 영상").onClick();
  video(render()).onError();
  assert.equal(video(render()).src, "/base");
  button(render(), "첨부 영상").onClick();
  button(render(), "음성 통화로 전환").onClick();
  assert.equal(video(render()), undefined);
  assert.equal(render().some(node => node.props.role === "group"), false);
  button(render(), "영상 통화로 전환").onClick();
  assert.equal(video(render()).src, "/base");
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

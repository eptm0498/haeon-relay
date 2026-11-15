import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as catalog from "../lib/dokyeong/model-catalog.ts";

function settingsApi() {
  const overrides = { textModel: "gemini-3.7-flash", voiceModel: "gemini-3.5-flash", speechModel: null, transcriptionModel: null };
  const requests = [];
  const exports = {};
  const source = fs.readFileSync(new URL("../lib/dokyeong/model-settings.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const mocks = {
    "./auth": { noStore: {}, sameOrigin: () => true },
    "./config": { liveConfig: { gemini: { responseModel: "gemini-3.8-flash" }, elevenlabs: {} } },
    "./model-catalog": catalog,
    "./settings": { rpc: async (_name, body) => {
      requests.push(body);
      return { overrides: body.settings ?? overrides, version: body.action === "save" ? 2 : 1 };
    } },
  };
  vm.runInNewContext(outputText, {
    exports, require: name => mocks[name], Response,
    process: { env: { CHARACTER_HISTORY_KEY: "fixture-only" } },
  });
  const endpoint = "https://app.test/api/dokyeong/model-settings";
  const save = (patch) => exports.modelSettingsResponse(new Request(endpoint, {
    method: "PUT",
    body: JSON.stringify({ version: 1, overrides: { ...overrides, ...patch } }),
  }));
  return { ...exports, requests, save, read: () => exports.modelSettingsResponse(new Request(endpoint)) };
}

test("the same free model choices and their price and speed details serve chat and voice", () => {
  const chat = catalog.liveModelFields.textModel.models;
  const voice = catalog.liveModelFields.voiceModel.models;
  assert.deepEqual(Object.keys(chat), Object.keys(catalog.geminiFreeModels));
  assert.deepEqual(voice, chat);
  assert.ok(Object.hasOwn(chat, "gemini-4-hydrogen"));
  assert.ok(Object.hasOwn(chat, "gemini-3.1-flash-lite"));
  for (const model of ["gemini-4-carbon", "gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3.7-flash"]) {
    assert.equal(Object.hasOwn(chat, model), false);
  }
  for (const detail of Object.values(catalog.geminiFreeModels)) {
    assert.ok(detail.paid.input > 0 && detail.paid.output > 0);
    assert.ok(detail.benchmark.tokensPerSecond > 0 && detail.benchmark.firstTokenSeconds > 0);
  }
});

test("saved aliases resolve to current models and paid-only choices are rejected before saving", async () => {
  const api = settingsApi();
  const { overrides } = await (await api.read()).json();
  assert.equal(overrides.textModel, "gemini-3.8-flash");
  assert.equal(overrides.voiceModel, "gemini-3.6-flash");
  assert.equal((await api.liveModelOverrides()).textModel, overrides.textModel);
  const accepted = await api.save({ textModel: "gemini-4-hydrogen", voiceModel: "gemini-3.1-flash-lite" });
  assert.equal(accepted.status, 200);
  assert.equal(api.requests.at(-1).settings.textModel, "gemini-4-hydrogen");
  assert.equal(api.requests.at(-1).settings.voiceModel, "gemini-3.1-flash-lite");
  const calls = api.requests.length;
  assert.equal((await api.save({ voiceModel: "gemini-4-carbon" })).status, 400);
  assert.equal(api.requests.length, calls);
});

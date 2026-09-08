import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../app/api/biseo/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { POST, GET } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const originalFetch = globalThis.fetch;
const originalKey = process.env.EXPLABS_API_KEY;
const request = body => new Request('http://localhost/api/biseo', { method: 'POST', body: JSON.stringify(body) });
const success = (finish = 'stop') => Response.json({ choices: [{ message: { content: '완성된 결과\n[실행 인계]\n파일 적용 후 검증' }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });

await test('비서 API 동작과 장애 처리', async t => {
  process.env.EXPLABS_API_KEY = 'xpl_test_key';
  try {
    await t.test('상태 확인과 단순 변경은 외부 요청 0회', async () => {
      globalThis.fetch = async () => { assert.fail('unexpected paid call'); };
      const health = await (await GET(new Request('http://localhost/api/biseo'))).json();
      assert.equal(health.workUsageDetection, false); assert.deepEqual(health.defaultModels, ['gpt-6-astra', 'claude-fable-5.1']);
      const data = await (await POST(request({ task: "'기존'을 '변경'으로 바꿔" }))).json();
      assert.equal(data.useSecretary, false); assert.equal(data.meta.calls, 0);
    });
    await t.test('강제 사용은 단순 작업도 기본 Astra 사용', async () => {
      let calls = 0;
      globalThis.fetch = async (_url, options) => { calls++; const payload = JSON.parse(options.body); assert.equal(payload.model, 'gpt-6-astra'); assert.ok(payload.max_tokens >= 5000); return success(); };
      const data = await (await POST(request({ task: "'기존'을 '변경'으로 바꿔", mode: 'force' }))).json();
      assert.equal(calls, 1); assert.equal(data.deliverable, '완성된 결과\n[실행 인계]\n파일 적용 후 검증'); assert.equal(data.meta.usage.total_tokens, 30);
    });
    await t.test('홈페이지 수정·프로그램 설계·분석은 Sol', async () => {
      globalThis.fetch = async (_url, options) => { assert.equal(JSON.parse(options.body).model, 'gpt-5.6-sol'); return success(); };
      const data = await (await POST(request({ task: '홈페이지 구조를 수정하고 프로그램 설계를 분석해' }))).json();
      assert.equal(data.meta.model, 'gpt-5.6-sol'); assert.equal(data.meta.route, 'balanced');
    });
    await t.test('코딩·디버깅·기술 문제는 Grok 4.6', async () => {
      globalThis.fetch = async (_url, options) => { assert.equal(JSON.parse(options.body).model, 'grok-4.6'); return success(); };
      const data = await (await POST(request({ task: 'TypeScript 런타임 오류를 디버깅해' }))).json();
      assert.equal(data.meta.model, 'grok-4.6'); assert.equal(data.meta.route, 'code');
    });
    await t.test('긴 자료·대량 문맥은 Gemini 3.7 Flash', async () => {
      globalThis.fetch = async (_url, options) => { assert.equal(JSON.parse(options.body).model, 'gemini-3.7-flash'); return success(); };
      const data = await (await POST(request({ task: '긴 자료 여러 문서를 전체 훑어서 요약해', context: '가'.repeat(17000) }))).json();
      assert.equal(data.meta.model, 'gemini-3.7-flash'); assert.equal(data.meta.route, 'long-context');
    });
    await t.test('Work 소진은 생략하지 않고 완성 결과 지시', async () => {
      globalThis.fetch = async (_url, options) => { assert.match(JSON.parse(options.body).messages[0].content, /사용량을 소진/); return success(); };
      const data = await (await POST(request({ task: "'기존'을 '변경'으로 바꿔", workStatus: 'exhausted' }))).json();
      assert.equal(data.useSecretary, true);
    });
    await t.test('빈 입력, JSON 오류, 모드 오류는 모델 호출 전 거절', async () => {
      globalThis.fetch = async () => { assert.fail('unexpected call'); };
      for (const body of [{ task: '' }, { task: 'x', mode: 'bad' }, { task: 'x', context: 42 }, { task: 'x'.repeat(30001) }]) assert.equal((await POST(request(body))).status, 400);
      assert.equal((await POST(new Request('http://localhost/api/biseo', { method: 'POST', body: '{' }))).status, 400);
    });
    await t.test('기본 Astra 장애는 Claude 1회 대체, 성공 결과 보존', async () => {
      const models = [];
      globalThis.fetch = async (_url, options) => { models.push(JSON.parse(options.body).model); return models.length === 1 ? new Response('unavailable', { status: 503 }) : success(); };
      const data = await (await POST(request({ task: '학부모 안내문 초안을 작성해' }))).json();
      assert.equal(data.ok, true); assert.deepEqual(models, ['gpt-6-astra', 'claude-fable-5.1']); assert.equal(data.meta.calls, 2);
    });
    await t.test('코드 모델 장애는 Sol로 대체', async () => {
      const models = [];
      globalThis.fetch = async (_url, options) => { models.push(JSON.parse(options.body).model); return models.length === 1 ? new Response('unavailable', { status: 503 }) : success(); };
      const data = await (await POST(request({ task: 'JavaScript 버그를 디버깅해' }))).json();
      assert.equal(data.ok, true); assert.deepEqual(models, ['grok-4.6', 'gpt-5.6-sol']);
    });
    await t.test('무료 한도 오류는 유료 전환과 대체 호출 없이 중단', async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: { code: 'insufficient_quota', message: 'free_limit_reached' } }, { status: 429 }); };
      const response = await POST(request({ task: '설계' })); assert.equal(response.status, 429); assert.equal(calls, 1); assert.equal((await response.json()).code, 'quota_exceeded');
    });
    await t.test('인증 실패는 반복 호출하지 않음', async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response('', { status: 401 }); };
      const data = await (await POST(request({ task: '설계' }))).json(); assert.equal(data.code, 'authentication_error'); assert.equal(calls, 1);
    });
    await t.test('빈 응답도 대체 모델로 복구', async () => {
      let calls = 0;
      globalThis.fetch = async () => ++calls === 1 ? Response.json({ choices: [] }) : success();
      assert.equal((await (await POST(request({ task: '학부모 안내문 초안을 작성해' }))).json()).ok, true); assert.equal(calls, 2);
    });
    await t.test('출력 잘림은 부분 결과로 표시', async () => {
      globalThis.fetch = async () => success('length');
      const data = await (await POST(request({ task: '설계' }))).json(); assert.equal(data.partial, true); assert.ok(data.warnings.length); assert.ok(data.deliverable);
    });
    await t.test('기본 양쪽 장애는 명시적 실패', async () => {
      globalThis.fetch = async () => new Response('unavailable', { status: 503 });
      const response = await POST(request({ task: '학부모 안내문 초안을 작성해' })); const data = await response.json(); assert.equal(response.status, 502); assert.equal(data.ok, false); assert.equal(data.meta.calls, 2);
    });
    await t.test('취소한 요청은 새 외부 호출 없이 종료', async () => {
      globalThis.fetch = async () => { assert.fail('unexpected call'); };
      const controller = new AbortController(); controller.abort();
      const response = await POST(new Request('http://localhost/api/biseo', { method: 'POST', body: JSON.stringify({ task: '학부모 안내문 초안을 작성해' }), signal: controller.signal })); assert.equal(response.status, 504);
    });
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.EXPLABS_API_KEY; else process.env.EXPLABS_API_KEY = originalKey; }
});

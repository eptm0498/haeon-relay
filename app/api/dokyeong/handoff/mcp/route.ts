import { noStore } from "@/lib/dokyeong/auth";
import { hasHandoffAccess, resourceMetadata, scope } from "@/lib/dokyeong/handoff-auth";
import { continueFromChatGPT, handoffRules } from "@/lib/dokyeong/jiwoo-handoff";

const authChallenge = `Bearer resource_metadata="${resourceMetadata}", scope="${scope}"`;
const securitySchemes = [{ type: "oauth2", scopes: [scope] }];
const tool = {
  name: "continue_jiwoo",
  title: "지우 이어가기",
  description: `한지우 프로젝트에서 사용자가 정확히 '이어가기'라고만 보냈을 때 호출해. 처음에는 인수 없이 호출해. status=received면 memo를 이미 있었던 일의 참고 자료로만 사용해서 지우의 말로 자연스럽게 대화를 이어가. status=summarize면 이 대화의 최신 맥락을 직접 요약해서 반환된 revision과 함께 같은 함수를 다시 호출해. ${handoffRules} status=sent이면 '이어갈 내용을 넘겼어. 캐릭터라이브 앱에서 이어가기라고 보내.'라고 짧게 알려줘. status=retry이면 인수 없이 한 번 다시 호출해.`,
  inputSchema: {
    type: "object", additionalProperties: false, properties: {
      memo: { type: "string", maxLength: 700, description: "상대 앱에 보낼 한국어 대화 맥락" },
      revision: { type: "integer", minimum: 0, description: "이 명령의 첫 호출에서 서버가 반환한 값" },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  securitySchemes,
  _meta: { securitySchemes },
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== "https://chatgpt.com") return new Response(null, { status: 403, headers: noStore });
  const raw = await request.text();
  if (raw.length > 10_000) return new Response(null, { status: 413, headers: noStore });
  let rpc: { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string; protocolVersion?: string; arguments?: { memo?: string; revision?: number } } };
  try { rpc = JSON.parse(raw); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { headers: noStore }); }
  const id = rpc?.id ?? null;
  const result = (value: object) => Response.json({ jsonrpc: "2.0", id, result: value }, { headers: noStore });
  const error = (code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: noStore });
  if (rpc?.jsonrpc !== "2.0" || typeof rpc.method !== "string") return error(-32600, "Invalid request");
  if (rpc.id === undefined && rpc.method.startsWith("notifications/")) return new Response(null, { status: 202, headers: noStore });
  if (rpc.method === "ping") return result({});
  if (rpc.method === "initialize") {
    const version = rpc.params?.protocolVersion;
    return result({ protocolVersion: version && ["2025-11-25", "2025-06-18", "2025-03-26"].includes(version) ? version : "2025-11-25",
      capabilities: { tools: {} }, serverInfo: { name: "jiwoo-handoff", version: "1.0.0" },
      instructions: "한지우 대화에서 사용자가 '이어가기'라고만 쓰면 continue_jiwoo를 인수 없이 먼저 호출한다." });
  }
  if (rpc.method === "tools/list") return result({ tools: [tool] });
  if (rpc.method !== "tools/call") return error(-32601, "Method not found");
  if (rpc.params?.name !== tool.name) return error(-32602, "Unknown tool");
  if (!hasHandoffAccess(request)) {
    if (!request.headers.has("authorization")) {
      return result({ isError: true, content: [{ type: "text", text: "캐릭터라이브 연결이 필요해." }],
        _meta: { "mcp/www_authenticate": [authChallenge] } });
    }
    return new Response(null, { status: 401, headers: { ...noStore, "WWW-Authenticate": authChallenge } });
  }
  const { memo, revision } = rpc.params.arguments ?? {};
  if (memo !== undefined && (typeof memo !== "string" || !memo.trim() || memo.length > 700 ||
    !Number.isSafeInteger(revision) || Number(revision) < 0)) return error(-32602, "Invalid memo");
  try {
    const state = await continueFromChatGPT(memo, revision);
    return result({ content: [{ type: "text", text: JSON.stringify(state) }] });
  } catch {
    return error(-32603, "이어가기 연결 오류");
  }
}

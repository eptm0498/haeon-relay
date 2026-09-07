export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_URL = "https://api.experientiallabs.ai/v1/chat/completions";
const ASTRA = "gpt-6-astra";
const CLAUDE = "claude-fable-5.1";

type Mode = "auto" | "force";

type Decision = {
  useSecretary: boolean;
  complexity: "low" | "medium" | "high";
  reason: string;
};

type CallResult = {
  text: string;
  usage?: unknown;
};

function getApiKey() {
  const apiKey = process.env.EXPLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("EXPLABS_API_KEY가 Vercel에 설정되어 있지 않습니다.");
  const hasNonAscii = [...apiKey].some((char) => char.charCodeAt(0) > 127);
  if (hasNonAscii || apiKey.includes("…")) {
    throw new Error("EXPLABS_API_KEY에 비정상 문자가 있습니다. 실제 전체 API 키를 다시 저장해 주세요.");
  }
  if (!apiKey.startsWith("xpl_")) {
    throw new Error("EXPLABS_API_KEY 형식이 올바르지 않습니다.");
  }
  return apiKey;
}

async function callModel(
  model: string,
  system: string,
  user: string,
  maxTokens = 700,
): Promise<CallResult> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message ?? data?.message ?? `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${model}이 빈 답변을 반환했습니다.`);
  return { text: String(text), usage: data?.usage ?? null };
}

function parseDecision(text: string): Decision {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      useSecretary: Boolean(parsed.useSecretary),
      complexity: ["low", "medium", "high"].includes(parsed.complexity)
        ? parsed.complexity
        : "medium",
      reason: String(parsed.reason ?? ""),
    };
  } catch {
    return {
      useSecretary: true,
      complexity: "medium",
      reason: "자동 분류 결과를 해석하지 못해 안전하게 비서를 사용합니다.",
    };
  }
}

async function classifyTask(task: string): Promise<Decision> {
  const system = `너는 ChatGPT Work 사용량 절약을 위한 라우터다. 작업을 Work가 바로 처리할지, 외부 비서(Astra+Claude)에게 먼저 계획을 맡길지 결정한다.\n\n비서를 생략(useSecretary=false): 한두 단계로 끝나는 단순하고 명확한 수정, 짧은 변환, 정답 경로가 명백한 작업.\n비서를 사용(useSecretary=true): 여러 단계, 원인 불명 오류, 설계/전략, 여러 파일, 조사나 비교가 필요함, 해결법이 여러 개임, 긴 작업, 실패 비용이 큼, 애매한 요구사항을 합리적으로 해석해야 함.\n\n반드시 JSON 하나만 출력: {"useSecretary":true,"complexity":"low|medium|high","reason":"짧은 이유"}`;
  const result = await callModel(ASTRA, system, task, 120);
  return parseDecision(result.text);
}

async function makeBrief(task: string) {
  const astraSystem = `너는 실행 설계 담당 비서다. ChatGPT Work가 불필요한 탐색 토큰을 쓰지 않도록 가장 효율적인 해결 경로를 설계하라. 사용자의 요구를 다시 길게 반복하지 마라. 핵심 접근, 실행 순서, 필요한 검증, 완료 조건을 한국어로 압축해서 작성하라. 600자 안쪽을 목표로 한다.`;
  const claudeSystem = `너는 비판·리스크 담당 비서다. ChatGPT Work가 시행착오로 토큰을 낭비하지 않도록 실패 가능성이 높은 지점, 놓친 변수, 더 싼/짧은 대안, 하지 말아야 할 접근을 찾아라. 다른 AI의 답을 추측하지 말고 독립적으로 검토하라. 한국어 600자 안쪽을 목표로 한다.`;

  const [astra, claude] = await Promise.all([
    callModel(ASTRA, astraSystem, task, 650),
    callModel(CLAUDE, claudeSystem, task, 650),
  ]);

  const synthSystem = `너는 Work 투입 직전의 압축 편집자다. 아래 작업과 두 비서 의견을 이용해 ChatGPT Work가 곧바로 실행할 수 있는 매우 압축된 브리핑 하나를 작성하라. 두 의견을 단순 병합하지 말고 충돌하면 더 타당한 쪽을 선택하라. 불필요한 설명과 인사말은 금지한다.\n\n형식:\n[권장 접근]\n...\n[실행 순서]\n1. ...\n2. ...\n[주의]\n...\n[완료 조건]\n...\n\n전체 900자 이내를 목표로 한다.`;

  const synthInput = `원래 작업:\n${task}\n\nAstra 의견:\n${astra.text}\n\nClaude 의견:\n${claude.text}`;
  const synthesis = await callModel(ASTRA, synthSystem, synthInput, 900);

  return {
    brief: synthesis.text,
    usage: {
      astraPlanning: astra.usage ?? null,
      claudeCritique: claude.usage ?? null,
      astraSynthesis: synthesis.usage ?? null,
    },
  };
}

async function handle(task: string, mode: Mode, debug = false) {
  if (!task.trim()) {
    return Response.json({ ok: false, error: "작업 내용이 없습니다." }, { status: 400 });
  }
  if (task.length > 30000) {
    return Response.json({ ok: false, error: "작업 내용은 30000자 이하로 줄여 주세요." }, { status: 400 });
  }

  try {
    const decision: Decision = mode === "force"
      ? { useSecretary: true, complexity: "high", reason: "사용자가 비서 의견을 명시적으로 요청함" }
      : await classifyTask(task);

    if (!decision.useSecretary) {
      return Response.json({
        ok: true,
        useSecretary: false,
        mode,
        decision,
        brief: "비서 생략 권장. 이 작업은 단순·명확하므로 Work가 바로 실행하는 편이 전체 사용량이 더 적습니다.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await makeBrief(task);
    return Response.json({
      ok: true,
      useSecretary: true,
      mode,
      decision,
      brief: result.brief,
      ...(debug ? {
        meta: {
          advisors: [ASTRA, CLAUDE],
          strategy: "external-plan+critique+external-synthesis",
          usage: result.usage,
          generatedAt: new Date().toISOString(),
        },
      } : {}),
    }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "비서 호출 중 알 수 없는 오류가 발생했습니다.",
    }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const task = typeof body?.task === "string" ? body.task : "";
  const mode: Mode = body?.mode === "force" ? "force" : "auto";
  const debug = body?.debug === true;
  return handle(task, mode, debug);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const task = searchParams.get("q") ?? "";
  const mode: Mode = searchParams.get("mode") === "force" ? "force" : "auto";
  const debug = searchParams.get("debug") === "1";
  return handle(task, mode, debug);
}

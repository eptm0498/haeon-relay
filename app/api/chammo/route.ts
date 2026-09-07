export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_URL = "https://api.experientiallabs.ai/v1/chat/completions";

const ADVISORS = [
  { id: "gpt-6-astra", name: "Astra" },
  { id: "claude-fable-5.1", name: "Claude" },
] as const;

type AdvisorResult = {
  name: string;
  model: string;
  answer?: string;
  usage?: unknown;
  error?: string;
};

function getApiKey() {
  const apiKey = process.env.EXPLABS_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("EXPLABS_API_KEY가 Vercel에 설정되어 있지 않습니다.");
  }

  const hasNonAscii = [...apiKey].some((char) => char.charCodeAt(0) > 127);
  if (hasNonAscii || apiKey.includes("…")) {
    throw new Error(
      "EXPLABS_API_KEY에 말줄임표(…) 같은 비정상 문자가 들어 있습니다. Experiential에서 발급 직후 표시되는 실제 전체 API 키를 다시 복사해 Vercel 환경변수에 저장해 주세요.",
    );
  }

  if (!apiKey.startsWith("xpl_")) {
    throw new Error(
      "EXPLABS_API_KEY 형식이 올바르지 않습니다. Experiential API 키는 xpl_로 시작해야 합니다.",
    );
  }

  return apiKey;
}

async function askModel(
  model: string,
  name: string,
  question: string,
): Promise<AdvisorResult> {
  const apiKey = getApiKey();

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "너는 사용자의 결정을 돕는 독립적인 참모다. 다른 AI가 어떤 답을 했을지 추측하지 말고 문제를 독립적으로 분석하라. 핵심 판단, 그 근거, 놓치기 쉬운 변수나 반론을 포함하되 불필요하게 길게 쓰지 말고 한국어로 명료하게 답하라. 가능하면 1200자 안쪽으로 답하라.",
        },
        {
          role: "user",
          content: question,
        },
      ],
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ??
      data?.message ??
      `${name} 호출 실패 (HTTP ${response.status})`;
    throw new Error(String(message));
  }

  const answer = data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(`${name}이 빈 답변을 반환했습니다.`);
  }

  return {
    name,
    model,
    answer: String(answer),
    usage: data?.usage ?? null,
  };
}

function settledResult(
  result: PromiseSettledResult<AdvisorResult>,
  name: string,
  model: string,
): AdvisorResult {
  if (result.status === "fulfilled") {
    return result.value;
  }

  return {
    name,
    model,
    error:
      result.reason instanceof Error
        ? result.reason.message
        : "알 수 없는 오류로 호출에 실패했습니다.",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const question = searchParams.get("q")?.trim();

  if (!question) {
    return Response.json(
      {
        ok: false,
        error: "질문이 없습니다. ?q=질문 형식으로 호출해 주세요.",
      },
      { status: 400 },
    );
  }

  if (question.length > 6000) {
    return Response.json(
      {
        ok: false,
        error: "질문이 너무 깁니다. 6000자 이하로 줄여 주세요.",
      },
      { status: 400 },
    );
  }

  const results = await Promise.allSettled(
    ADVISORS.map((advisor) => askModel(advisor.id, advisor.name, question)),
  );

  const advisors = results.map((result, index) =>
    settledResult(result, ADVISORS[index].name, ADVISORS[index].id),
  );

  const successCount = advisors.filter((advisor) => advisor.answer).length;

  return Response.json(
    {
      ok: successCount > 0,
      question,
      advisors,
      meta: {
        successCount,
        requestedCount: ADVISORS.length,
        generatedAt: new Date().toISOString(),
      },
    },
    {
      status: successCount > 0 ? 200 : 502,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

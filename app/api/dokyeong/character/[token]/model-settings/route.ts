import type { NextRequest } from "next/server";
import { noStore, sameOrigin } from "@/lib/dokyeong/auth";
import { modelSettingsResponse } from "@/lib/dokyeong/model-settings";
import { verifyEditor } from "@/lib/dokyeong/settings";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };

async function handle(request: NextRequest, { params }: Context) {
  if (request.method === "PUT" && !sameOrigin(request)) {
    return Response.json({ error: "요청을 확인해 줘." }, { status: 403, headers: noStore });
  }
  try {
    const { token } = await params;
    if (!await verifyEditor(token)) {
      return Response.json({ error: "편집 링크를 확인해 줘." }, { status: 404, headers: noStore });
    }
    return await modelSettingsResponse(request);
  } catch {
    return Response.json({ error: "편집 권한을 확인하지 못했어." }, { status: 503, headers: noStore });
  }
}

export const GET = handle;
export const PUT = handle;

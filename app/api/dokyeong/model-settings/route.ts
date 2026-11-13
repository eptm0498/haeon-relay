import type { NextRequest } from "next/server";
import { authenticated, unauthorized } from "@/lib/dokyeong/auth";
import { modelSettingsResponse } from "@/lib/dokyeong/model-settings";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return authenticated(request) ? modelSettingsResponse(request) : unauthorized();
}

export function PUT(request: NextRequest) {
  return authenticated(request) ? modelSettingsResponse(request) : unauthorized();
}

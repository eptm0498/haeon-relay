import { issuer, oauthResponse, resource, scope } from "@/lib/dokyeong/handoff-auth";

export function GET() {
  return oauthResponse({ resource, authorization_servers: [issuer], scopes_supported: [scope], bearer_methods_supported: ["header"] });
}

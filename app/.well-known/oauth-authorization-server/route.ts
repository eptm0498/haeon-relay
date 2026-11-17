import { issuer, oauthPath, oauthResponse, scope } from "@/lib/dokyeong/handoff-auth";

export function GET() {
  return oauthResponse({
    issuer, authorization_response_iss_parameter_supported: true,
    authorization_endpoint: issuer + oauthPath + "/authorize", token_endpoint: issuer + oauthPath + "/token",
    client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"], response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"], scopes_supported: [scope],
  });
}

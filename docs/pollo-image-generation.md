# Chat image generation

Chat image jobs use PolloJourney V8.2 first when the server-only `POLLO_API_KEY` is set. Existing album matching remains the first choice when a suitable stored picture is available. Profile generation continues to use the configured OpenAI image model.

The existing scene planner provides appearance and the requested scene. The original request is retained. Pollo's 1,000-character limit is checked before submission; oversized requests use GPT without truncating the scene or dropping the original intent.

Pollo requires HTTP image URLs. The app signs ten-minute links to specific reference slots. When multiple identity/source references exist, a labeled reference board is served through one signed URL, preserving face/body roles and avoiding the model's single-reference limit. Requests without a valid signature never read character data. References are never published to a public storage bucket, and responses are non-cacheable JPEGs.

The server submits one Pollo task, polls within an 80-second budget, downloads its result without forwarding credentials, checks it, and saves the normal chat image. Authentication, quota, network, timeouts and unsupported inputs/results fall back once to the existing GPT image path. No upstream messages, reference URLs or credentials are logged. Cancellation stops processing.

Input/reference and output checks apply before a Pollo image can be sent. A rejected request or output stops without switching providers. GPT fallback keeps its existing moderation setting and original references. The integration does not turn model refusals into a retry through another provider.

Required server configuration:

- `POLLO_API_KEY` in production and preview, stored as a sensitive environment variable.
- Existing `OPENAI_API_KEY` and optional `OPENAI_IMAGE_MODEL` for checks and fallback.
- Existing `CHARACTER_HISTORY_KEY` for the signed reference endpoint and existing history access.

Provider documentation: <https://api.pollo.ai/pollo-ai/pollojourney-v8-2-image> and <https://docs.pollo.ai/openapi.json>.

Checks: `node --test tests/image-generation.test.mjs tests/image-reference.test.mjs`. Both are also part of the normal deployment regression checks. Tests cover primary success, one fallback on technical failure, refusal handling, complete original references, credentials staying off CDN requests, link expiry/tampering and reference serving.

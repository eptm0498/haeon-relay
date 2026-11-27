# Chat image generation

Chat image jobs use PolloJourney V8.2 in **2K text-to-image mode** first when the server-only `POLLO_API_KEY` is set. Existing album matching remains the first choice when a suitable stored picture is available. Profile generation continues to use the configured OpenAI image model.

The existing scene planner provides appearance and the requested scene. The original request is retained. Pollo's 1,000-character limit is checked before submission; oversized requests use GPT without truncating the scene or dropping the original intent.

Pollo receives only the text prompt, aspect ratio and `resolution: "2K"`; no reference URLs, images or reference boards are submitted. Character appearance comes from the written scene plan, so exact reference-photo identity is not guaranteed in this mode. Requests to edit an existing photo use GPT because they require an image input. GPT fallback retains the existing original reference images.

Delivered Pollo images retain their 2K dimensions. A separate 1K preview is used only for output checking. JPEG compression can be reduced to fit the existing chat storage limit without downscaling the 2K result.

The server submits one Pollo task, polls within an 80-second budget, downloads its result without forwarding credentials, checks it, and saves the normal chat image. Authentication, quota, network, timeouts and unsupported inputs/results fall back once to the existing GPT image path. No upstream messages, reference URLs or credentials are logged. Cancellation stops processing.

Input and output checks apply before a Pollo image can be sent. A rejected request or output stops without switching providers. GPT fallback keeps its existing moderation setting and original references. The integration does not turn model refusals into a retry through another provider.

Required server configuration:

- `POLLO_API_KEY` in production and preview, stored as a sensitive environment variable.
- Existing `OPENAI_API_KEY` and optional `OPENAI_IMAGE_MODEL` for checks and fallback.
- Existing `CHARACTER_HISTORY_KEY` for the signed reference endpoint and existing history access.

Provider documentation: <https://api.pollo.ai/pollo-ai/pollojourney-v8-2-image> and <https://docs.pollo.ai/openapi.json>.

Checks: `node --test tests/image-generation.test.mjs tests/image-reference.test.mjs`. Both are also part of the normal deployment regression checks. Tests cover primary success, one fallback on technical failure, refusal handling, 2K text-to-image request fields, no image inputs sent to Pollo, 2K delivery dimensions, original references on GPT fallback, and credentials staying off CDN requests. The retained reference utility has separate expiry/tampering and serving tests.

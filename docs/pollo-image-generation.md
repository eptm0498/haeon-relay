# Chat image generation

Image selection follows this order: **matching album photo → GPT image generation → PolloJourney V8.2 in 2K text-to-image mode**. A suitable stored photo is preferred by the existing album reply flow. New photo requests use the configured OpenAI image model with the original face/body references. Pollo is attempted only after a technical GPT failure, when the server-only `POLLO_API_KEY` is set. Successful GPT generation makes no Pollo request. Explicit requests for a newly taken photo retain the existing fresh-photo behavior. Profile generation and edits of an existing photo continue to use GPT only.

The existing scene planner provides appearance and the requested scene. The original request is retained. Pollo's 1,000-character limit is checked before submission; oversized requests remain GPT-only without truncating the scene or dropping the original intent.

Pollo receives only the text prompt, aspect ratio and `resolution: "2K"`; no reference URLs, images or reference boards are submitted. Character appearance comes from the written scene plan, so exact reference-photo identity is not guaranteed in this fallback mode. Requests to edit an existing photo use GPT because they require an image input.

Delivered Pollo images retain their 2K dimensions. A separate 1K preview is used only for output checking. JPEG compression can be reduced to fit the existing chat storage limit without downscaling the 2K result.

Authentication, quota, model-access, network, timeouts and unusable GPT results can trigger one Pollo attempt. When Pollo fallback is available, GPT has a 90-second deadline to leave time within the overall 180-second job budget; GPT-only requests retain the original overall deadline. The server submits one Pollo task, polls within an 80-second budget, downloads its result without forwarding credentials, checks it, and saves the normal chat image. If both providers fail, processing stops; it never cycles back to GPT. No upstream messages, reference URLs or credentials are logged. Cancellation stops processing without fallback.

GPT keeps its existing moderation setting and original references. A GPT rejection stops without calling Pollo. Input and output checks apply before a Pollo image can be sent; a rejected request or output also stops. The integration does not turn model refusals into a retry through another provider.

Required server configuration:

- `POLLO_API_KEY` in production and preview, stored as a sensitive environment variable.
- Existing `OPENAI_API_KEY` and optional `OPENAI_IMAGE_MODEL` for primary generation and checks.
- Existing `CHARACTER_HISTORY_KEY` for the signed reference endpoint and existing history access.

Provider documentation: <https://api.pollo.ai/pollo-ai/pollojourney-v8-2-image> and <https://docs.pollo.ai/openapi.json>.

Checks: `node --test tests/image-generation.test.mjs tests/image-reference.test.mjs tests/reply-jobs.test.mjs`. All are part of the normal deployment regression checks. Tests cover album replies without image jobs, GPT-first success with original references, one Pollo fallback on technical failure, no provider cycling, refusal/cancellation handling, 2K text-to-image fields and delivery dimensions, no image inputs sent to Pollo, and credentials staying off CDN requests. The retained reference utility has separate expiry/tampering and serving tests.

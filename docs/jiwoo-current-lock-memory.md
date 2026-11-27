# Jiwoo current lock record

Only the standalone Jiwoo character has this feature. It stores one current lock session, outside conversational summaries. A new current code replaces the previous record; historical, hypothetical and future codes are not imported. Conversation reset invalidates the old record through the history epoch. Version checks and event ordering reject stale jobs and delayed OCR writes.

An explicitly labeled current code in text is preserved as a string, including leading zeros. A new password photo in lock context is read twice with separate image-only OCR prompts. Both clear readings must agree before it becomes active. A disagreement or failed reading leaves the new session pending with no old code available. Agreement reduces errors but cannot guarantee perfect image recognition; the user should retain their original recovery information.

The current value is encrypted with AES-256-GCM using a purpose-specific key derived from the existing server-only history capability, and bound to the session and history epoch. The private table has RLS and no client grants. The existing capability-authenticated RPC pattern is used; invalid capabilities and other characters are rejected. The security advisor's deny-all RLS notice and capability RPC notice are intentional. No plaintext code or image is logged.

Code requests bypass the language model and return the stored string. Jiwoo can also select `lockAction=disclose` in a text reply, or `[LOCK_CODE]` in a buffered call reply; the app resolves that action to the same stored value. Call speech reads the digits separately. Failure to read or decrypt a record never falls back to a number from model memory.

Disclosure is separate from actual opening. The record remains available if the first opening attempt fails. After the user confirms that it opened, the ciphertext is erased and only the opening-confirmation timestamp remains, displayed in Korean time. Fictional actions inside asterisks, questions, future plans, a model saying it unlocked, and failed opening attempts do not clear the record. No physical device is controlled.

Deletion concerns this dedicated current-code record. Existing chat messages and attachments remain subject to the app's existing history controls. Lock numbers are masked from model transcripts and summaries, and old key photos are removed from model-message context. The app does not re-import an old photo as the active code. Previously sent photos must be sent again as the current code after this feature is enabled.

# Contextual photos

Direct selfie/capture requests, visual appearance requests, and acceptance of a recent photo offer can start the photo flow without requiring a promise in Jiwoo's text. Ordinary capture requests (including “사진 찍어줘”) search the album first; explicitly requesting a new capture or generation retains the GPT path. Short activity questions inherit a recent visual request, while ordinary greetings do not force generation. A concrete daily scene supplied in a text reply can also initiate the photo action. A cancellation ends the preceding visual context.

Before generating a non-fresh request, a missing or invalid album selection receives one additional semantic check against every eligible photo's tags and description, including entries outside the first shortlist. The check includes the current reply and scene to preserve location, clothes and activity; unrelated pictures are not selected. Calls use the same request recognition and album-first recovery when the model omits its scene marker or image tool. Missing matches retain the GPT path. Ordinary selfie requests must not add sexual staging. Cancellation and current refusals remain effective. Generation order stays GPT, then Pollojourney V8.2 2K on technical failure.

Checks: `node --test tests/jiwoo-lock.test.mjs tests/reply-jobs.test.mjs tests/voice-latency.test.mjs`. `tests/jiwoo-lock.sql` exercises database transitions and permissions inside a rollback-only transaction before enabling the new store. The normal production build includes these regression suites.

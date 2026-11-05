# First audio latency

The voice response route reads activity, dialogue samples, accumulated memory and
project context concurrently after the character is authorized and loaded. No
memory or dialogue examples are removed, cached across characters or shortened.

The Eleven v4 Turbo socket opens while Gemini prepares response headers. A
10-second keep-alive prevents an idle prewarmed socket from expiring, and every
error, HTTP failure, stream cancellation and normal completion releases it.

The first complete sentence requests a single `flush` so short Korean replies
need not reach the provider's normal character/word threshold. Split punctuation
is retained, decimal points do not cause a premature flush, and later text keeps
the same socket. Intermediate turn-final markers do not close the response;
socket-final completion drains the remaining audio before cleanup.

Jiwoo's existing complete-response dialogue validation remains in place. Audio
format, client playback buffer, recognition endpointing, models, character voices,
conversation history synchronization and reply length are unchanged.

`done.timings` and `LIVE_VOICE_TIMING` contain stage durations only, without
messages, prompts, credentials or audio. Ordinary builds run deterministic
streaming/concurrency/cancellation tests without paid requests. An explicitly
tagged `[verify-latency]` deployment additionally makes one brief diagnostic turn
against the previous production deployment and the new local build. It supplies
no request ID, so it cannot write conversation history or schedule activities.
Provider/credit failures are reported as unavailable. Two samples do not establish
a stable speedup; microphone endpointing, transcription, synchronization, network
conditions and provider load still contribute to perceived response time.

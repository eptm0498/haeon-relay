/** Decide when a muted, audio-only Jiwoo call should make its next short turn. */
export type MutedAudioTurn = "start" | "followup";
export function selectMutedAudioTurn(input: {
  now: number;
  lastRequestAt: number;
  hasStarted: boolean;
  microphoneMuted: boolean;
  videoOn: boolean;
  cameraOn: boolean;
}): MutedAudioTurn | null {
  if (!input.microphoneMuted || input.videoOn || input.cameraOn) return null;
  if (input.lastRequestAt && input.now - input.lastRequestAt < 8_000) return null;
  return input.hasStarted ? "followup" : "start";
}

/** Natural, camera-driven follow-up during a silent video call. */
export type VisualMonologueKind = "motion" | "followup";
export type VisualMonologueInput = {
  now: number;
  lastMotionAt: number;
  reactedMotionAt: number;
  lastRequestAt: number;
  lastSpeechAt: number;
  hasStarted: boolean;
};

/**
 * A new gesture starts a turn. Recent movement then allows follow-up turns
 * while the caller stays quiet. Stop after the scene has been still for a
 * while; a new spoken turn always has priority.
 */
export function selectVisualMonologueTurn(input: VisualMonologueInput): VisualMonologueKind | null {
  const { now, lastMotionAt, reactedMotionAt, lastRequestAt, lastSpeechAt, hasStarted } = input;
  if (!lastMotionAt || lastMotionAt > now || now - lastMotionAt > 24_000) return null;
  if (lastSpeechAt && now - lastSpeechAt < 4_000) return null;
  if (lastRequestAt && now - lastRequestAt < 4_000) return null;
  if (lastMotionAt > reactedMotionAt) return "motion";
  return hasStarted ? "followup" : null;
}

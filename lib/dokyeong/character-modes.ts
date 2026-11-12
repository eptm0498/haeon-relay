// This is the new, standalone Jiwoo. Do not reuse the archived character's ID.
export const VOICE_ONLY_JIWOO_ID = "8bda7b48-b3bc-4c8e-900b-7b92b04fe21c";

export function isVoiceOnlyCharacter(id?: string | null) {
  return id?.toLowerCase() === VOICE_ONLY_JIWOO_ID;
}

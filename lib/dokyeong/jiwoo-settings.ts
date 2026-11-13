import { defaultJiwooPreferences, type JiwooPreferences } from "./jiwoo-preferences";
import { rpc } from "./settings";

export async function readJiwooPreferences(signal?: AbortSignal) {
  try {
    return await rpc<JiwooPreferences>("live_jiwoo_preferences", {
      access_token: process.env.CHARACTER_HISTORY_KEY, editor: false, action: "read",
    }, 5000, signal ? AbortSignal.any([signal, AbortSignal.timeout(2200)]) : AbortSignal.timeout(2200));
  } catch {
    return defaultJiwooPreferences;
  }
}

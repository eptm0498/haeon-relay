import { createHash, createHmac } from "node:crypto";
import { categoryFor, ImportedSample, SampleCategory } from "./sample-parser";
import { rpc } from "./settings";
import { dialogueStylePrompt, selectVoiceSamples, styleQuery, type DialogueMedium } from "./dialogue-style";

export type DialogueSample = {
  id: string; cue: string; reply: string; spoken: string;
  category: SampleCategory; quality: number; enabled: boolean;
  created_at: string; updated_at: string;
};

function readerToken() {
  const secret = process.env.DOKYEONG_ACCESS_CODE?.trim();
  if (!secret || secret.length < 12) throw new Error("Dokyeong access code is not configured");
  return createHmac("sha256", secret).update("dokyeong-sample-reader-v1").digest("hex");
}

export function registerSampleReader(editToken: string) {
  const hash = createHash("sha256").update(readerToken()).digest("hex");
  return rpc<boolean>("dokyeong_register_sample_reader", { edit_token: editToken, reader_hash: hash });
}

export function listSamples(editToken: string, characterId: string, page: number, search: string, filter: string) {
  return rpc<{ items: DialogueSample[]; total: number }>("live_list_samples", {
    edit_token: editToken, character_id: characterId, page_number: page, search_text: search, state_filter: filter,
  }, 10000);
}

export function saveSample(editToken: string, characterId: string, sample: Partial<DialogueSample>) {
  return rpc<DialogueSample>("live_save_sample", {
    edit_token: editToken, character_id: characterId, sample_id: sample.id || null,
    sample_cue: sample.cue, sample_reply: sample.reply,
    sample_spoken: sample.spoken, sample_category: sample.category,
    sample_enabled: sample.enabled ?? true,
  }, 10000);
}

export function deleteSample(editToken: string, characterId: string, id: string) {
  return rpc<boolean>("live_delete_sample", { edit_token: editToken, character_id: characterId, sample_id: id });
}

export function importSampleBatch(editToken: string, characterId: string, samples: ImportedSample[]) {
  return rpc<number>("live_import_samples", { edit_token: editToken, character_id: characterId, samples }, 15000);
}

export async function relatedSampleContext(messages: { role: string; content: string }[], characterId: string, characterName: string, medium: DialogueMedium = "chat") {
  if (!["온유", "도경", "두리"].includes(characterName)) return "";
  const query = styleQuery(messages);
  const category = categoryFor(query.context, "");
  try {
    const candidates = await rpc<DialogueSample[]>("live_voice_samples", {
      server_token: process.env.CHARACTER_HISTORY_KEY, target_character: characterId,
      query_terms: query.terms, preferred_category: category, variation: query.seed,
    }, 4000);
    return dialogueStylePrompt(messages, characterName, selectVoiceSamples(candidates, messages, category), medium);
  } catch {
    console.warn("LIVE_VOICE_SAMPLES_UNAVAILABLE", characterId);
    return dialogueStylePrompt(messages, characterName, [], medium);
  }
}

import { createHash, createHmac } from "node:crypto";
import { categoryFor, ImportedSample, SampleCategory } from "./sample-parser";
import { rpc } from "./settings";

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

export function listSamples(editToken: string, page: number, search: string, filter: string) {
  return rpc<{ items: DialogueSample[]; total: number }>("dokyeong_list_samples", {
    edit_token: editToken, page_number: page, search_text: search, state_filter: filter,
  }, 10000);
}

export function saveSample(editToken: string, sample: Partial<DialogueSample>) {
  return rpc<DialogueSample>("dokyeong_save_sample", {
    edit_token: editToken, sample_id: sample.id || null,
    sample_cue: sample.cue, sample_reply: sample.reply,
    sample_spoken: sample.spoken, sample_category: sample.category,
    sample_enabled: sample.enabled ?? true,
  }, 10000);
}

export function deleteSample(editToken: string, id: string) {
  return rpc<boolean>("dokyeong_delete_sample", { edit_token: editToken, sample_id: id });
}

export function importSampleBatch(editToken: string, samples: ImportedSample[]) {
  return rpc<number>("dokyeong_import_samples", { edit_token: editToken, samples }, 15000);
}

function grams(value: string) {
  const clean = value.toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) result.add(clean.slice(i, i + 2));
  return result;
}

function similarity(query: Set<string>, cue: string) {
  const candidate = grams(cue);
  if (!query.size || !candidate.size) return 0;
  let shared = 0;
  for (const part of query) if (candidate.has(part)) shared++;
  return shared / Math.sqrt(query.size * candidate.size);
}

export async function relatedSampleContext(messages: { role: string; content: string }[]) {
  const latest = messages.at(-1)?.content?.trim() || "";
  if (!latest) return "";
  // Only consult reviewed examples for recognizable conversational cues. Loose
  // n-gram matches can turn an unrelated historical reply into a present claim.
  const intentTerms = ["사랑", "보고싶", "잘자", "고마워", "미안", "졸려", "귀여워", "힘들"];
  const compact = latest.replace(/\s+/g, "");
  const term = intentTerms.find((candidate) => compact.includes(candidate));
  if (!term) return "";
  try {
    const category = categoryFor(latest, "");
    const candidates = await rpc<DialogueSample[]>("dokyeong_match_samples", {
      reader_token: readerToken(), sample_category: category, cue_term: term,
    }, 4000);
    const query = grams(latest);
    const ranked = candidates.map((sample) => ({
      sample,
      score: similarity(query, sample.cue) * 100 + sample.quality / 15 -
        Math.abs(latest.length - sample.cue.length) / 90,
    })).sort((a, b) => b.score - a.score);
    const chosen: DialogueSample[] = [];
    for (const { sample } of ranked) {
      if (similarity(query, sample.cue) < 0.38 || sample.cue.length > 120 || sample.spoken.length > 120 ||
        chosen.some((other) => other.spoken === sample.spoken)) continue;
      chosen.push(sample);
      if (chosen.length === 2) break;
    }
    if (!chosen.length) return "";
    return `\n\n[과거 대화의 반응 참고 — 현재 사실이나 기억 아님]\n` +
      `아래는 도경의 대화 리듬 참고용 예시다. 당시 인물·장소·일정·관계를 현재에 적용하거나 문장을 그대로 반복하지 마. 지금 형의 말에 맞춰 자연스러운 입말로 반응해.\n` +
      chosen.map((sample, i) => `예시 ${i + 1}\n형: ${sample.cue}\n도경: ${sample.spoken}`).join("\n\n");
  } catch {
    // The live conversation remains available if the sample database is unavailable.
    return "";
  }
}

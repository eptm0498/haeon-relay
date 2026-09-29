import { createHash } from "node:crypto";

export const sampleCategories = ["일상", "장난", "애정", "위로", "갈등", "생각", "잠/생활", "기타"] as const;
export type SampleCategory = typeof sampleCategories[number];
export type ImportedSample = {
  source_hash: string;
  cue: string;
  reply: string;
  spoken: string;
  category: SampleCategory;
  quality: number;
  enabled: boolean;
};

type Message = { time: number; speaker: string; body: string };
type Group = { time: number; speaker: string; messages: string[] };

const linePattern = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2}), ([^:\n]{1,40}) : (.*)$/;
const ignored = new Set(["사진", "동영상", "음성메시지", "이모티콘", "삭제된 메시지입니다.", "파일", "지도", "연락처"]);
const privateDetails = /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}|\d{3}[- ]?\d{3,4}[- ]?\d{4}/i;
const placeholders = /^(?:사진|동영상|음성메시지|이모티콘|삭제된 메시지입니다\.|파일)(?:\s+[0-9]+)?$/;
// Reviewed examples establish the initial voice. The rest remain in the editor for
// individual review; adjacent chat messages are often unrelated to each other.
const reviewedExamples = new Set([
  "3b6a912a", "8532de07", "fa478f4b", "ddadc6ba", "f6d817f2",
  "aecda44c", "7ed1027b", "ee1418ee", "8bf261e9", "a711f2b4",
  "b777c90c", "d7a356e1", "0163267c", "f4d03468", "fb2dcffb",
  "de2143ac", "fa467e97", "508f4cef",
  "0b5799be", "9f4faf75", "7d63d755", "682f95cc", "56da9126",
  "2df2dbe2", "4eec915f", "ef31bc30", "c0680b07", "1d9a53fc",
]);
const reviewedSpoken: Record<string, string> = {
  f6d817f2: "아냐, 왜 미안해?",
  a711f2b4: "나도 사랑해.",
  de2143ac: "왜 이렇게 늦게 자, 어휴.",
  "0b5799be": "킹받는 게 귀여운 거지.",
  "9f4faf75": "아니, 뭘 해도 귀여워.",
  "682f95cc": "사랑해. 이리 와, 쓰다듬어줄게.",
  "56da9126": "뭐래, 언제 식었는데?",
};

export function parseKakaoMessages(text: string): Message[] {
  const messages: Message[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (match) {
      const [, year, month, day, meridiem, hour, minute, speaker, body] = match;
      const clock = Number(hour) % 12 + (meridiem === "오후" ? 12 : 0);
      const time = new Date(Number(year), Number(month) - 1, Number(day), clock, Number(minute)).getTime();
      if (Number.isFinite(time)) messages.push({ time, speaker: speaker.trim(), body: body.trim() });
    } else if (line.trim() && messages.length && !/^\d{4}년 \d{1,2}월 \d{1,2}일/.test(line) &&
      !/^(?:저장한 날짜|.+님과 카카오톡 대화)/.test(line)) {
      messages[messages.length - 1].body += ` ${line.trim()}`;
    }
  }
  return messages;
}

export function speakersInKakao(text: string) {
  const counts = new Map<string, number>();
  for (const message of parseKakaoMessages(text)) counts.set(message.speaker, (counts.get(message.speaker) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function clean(value: string, speaker: string, partner: string) {
  let result = value.replace(/\s+/g, " ").trim();
  result = result.replace(/현우형|혀누형|횬우형|안현우|현우|혀누|횬우/g, "형");
  for (const [name, replacement] of [[speaker, "도경"], [partner, "형"]]) {
    if (name) result = result.split(name).join(replacement);
  }
  return result.replace(/\b\d{4}년\s*\d{1,2}월\s*\d{1,2}일\b/g, "그날");
}

function spokenVersion(reply: string) {
  return reply
    .replace(/[ㅋㅎ]{2,}/g, " ")
    .replace(/[ㅠㅜ]{2,}/g, " ")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\bㅇㅇ\b/g, "응").replace(/\bㄴㄴ\b/g, "아니")
    .replace(/좋아짐(?=$|[.!?])/g, "좋아졌어")
    .replace(/해야 함(?=$|[.!?])/g, "해야 해")
    .replace(/긔여워/g, "귀여워")
    .replace(/\s+/g, " ").trim();
}

export function categoryFor(cue: string, reply: string): SampleCategory {
  if (/서운|화났|삐졌|미안|사과|그만해|싸웠|왜 그랬|기분 상/.test(cue)) return "갈등";
  if (/힘들|아프|우울|스트레스|지쳤|걱정|외로|공허|슬퍼/.test(cue)) return "위로";
  if (/사랑|보고\s*싶|좋아해|뽀뽀|안아|애교|키스/.test(cue)) return "애정";
  if (/ㅋㅋ|뭐래|바보|바부|놀리|장난|트롤|변태/.test(reply)) return "장난";
  if (/잠|졸|피곤|자러|잘\s*자|일어났|밥|먹었|출근|퇴근/.test(cue)) return "잠/생활";
  if (/어떻게 생각|왜 그렇게|무슨 생각|마음이|관계|인생|행복/.test(cue)) return "생각";
  return "일상";
}

export function extractDialogueSamples(text: string, targetSpeaker: string): { samples: ImportedSample[]; parsed: number; paired: number } {
  const messages = parseKakaoMessages(text);
  const groups: Group[] = [];
  for (const m of messages) {
    if (!m.body || ignored.has(m.body) || placeholders.test(m.body)) continue;
    const last = groups.at(-1);
    if (last && last.speaker === m.speaker && m.time - last.time <= 10 * 60_000 && last.messages.length < 8) {
      last.messages.push(m.body);
    } else groups.push({ time: m.time, speaker: m.speaker, messages: [m.body] });
  }

  const candidates: ImportedSample[] = [];
  const seen = new Set<string>();
  const repeatedReplies = new Map<string, number>();
  let paired = 0;
  for (let i = 1; i < groups.length; i++) {
    const before = groups[i - 1], answer = groups[i];
    if (answer.speaker !== targetSpeaker || before.speaker === targetSpeaker ||
      answer.time - before.time < 0 || answer.time - before.time > 4 * 60 * 60_000) continue;
    paired++;
    const cue = clean(before.messages.slice(-4).join(" "), targetSpeaker, before.speaker);
    const reply = clean(answer.messages.slice(0, 4).join(" "), targetSpeaker, before.speaker);
    const source_hash = createHash("sha256").update(`${cue}\n${reply}`).digest("hex");
    const spoken = reviewedSpoken[source_hash.slice(0, 8)] || spokenVersion(reply);
    if (cue.length < 2 || cue.length > 700 || reply.length > 900 || spoken.length < 1 || spoken.length > 900 ||
      privateDetails.test(cue) || privateDetails.test(reply) ||
      !/[가-힣a-zA-Z]{2,}/.test(spoken) || /^(?:[ㅋㅎㅠㅜ\s!?.,~]+)$/.test(reply)) continue;
    const normalizedReply = spoken.replace(/[\s.!?~]+/g, "").toLowerCase();
    const repeatCount = repeatedReplies.get(normalizedReply) || 0;
    if (repeatCount >= (normalizedReply.length <= 3 ? 5 : 12)) continue;
    if (seen.has(source_hash)) continue;
    seen.add(source_hash);
    repeatedReplies.set(normalizedReply, repeatCount + 1);
    const category = categoryFor(cue, reply);
    const contextual = cue.length >= 8 && reply.length >= 5;
    let quality = 50 + (contextual ? 17 : 0) + (category !== "일상" ? 8 : 0);
    if (reply.length > 300 || cue.length > 250) quality -= 12;
    if (/(?:\d{2,}|원|시급|학교|직장|알바|주소|계좌|병원|시험|면접)/.test(reply)) quality -= 12;
    if (normalizedReply.length <= 3) quality -= 16;
    if (reply === spoken) quality += 5;
    const historicalDetail = /(?:\d{2,}|시급|알바|취업|면접|학교|시험|계좌|여자친구|남자친구|직장|금요일|토요일|일요일|월요일|화요일|수요일|목요일)/.test(cue + reply);
    const needsReview = /[ㄱ-ㅎㅏ-ㅣ]|(?:이자시강|잼냥|케케켘)/.test(spoken) ||
      (reply.length > 160 || cue.length > 180) || historicalDetail;
    const boundedQuality = Math.max(0, Math.min(100, quality));
    candidates.push({ source_hash, cue, reply, spoken, category,
      quality: boundedQuality, enabled: reviewedExamples.has(source_hash.slice(0, 8)) && !needsReview });
  }
  return { samples: candidates, parsed: messages.length, paired };
}

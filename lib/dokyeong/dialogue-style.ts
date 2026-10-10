import { createHash } from 'node:crypto';

export type StyleMessage = { role: string; content: string };
export type VoiceSample = { id: string; cue: string; reply: string; spoken: string; category: string; quality: number };
export type DialogueMedium = 'chat' | 'voice';

// Match conversational subjects as well as emotional phrases. Short follow-ups
// borrow the preceding user's subject, never another character's archive.
const topics = [
  ['밥', '먹', '식사', '배고', '맛', '라면', '치킨', '커피', '메뉴'],
  ['출근', '퇴근', '일하', '수업', '학원', '학생', '교재', '일했'],
  ['게임', '롤', '칼바람', '증바람', '스타듀', '한판', '몇판'],
  ['공부', '과제', '시험', '임용', '교생', '수업'],
  ['운동', '헬스', '근육', '복근', '배사진', '배보여', '사진', '셀카'],
  ['피곤', '졸', '잠', '잘자', '일어', '누워', '쉬', '휴식'],
  ['아프', '감기', '몸살', '걱정', '힘들', '우울', '속상'],
  ['서운', '미안', '사과', '화났', '연락', '답장'],
  ['보고싶', '사랑', '좋아해', '고마', '귀여', '칭찬'],
  ['방송', '컨텐츠', '콘텐츠', '시청', '재밌', '재미'],
  ['고민', '생각', '선택', '결정', '어떻게', '이유'],
  ['뭐해', '뭐하', '모해', '어디', '지금'],
];

function compact(value: string) {
  return value.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
}
function grams(value: string) {
  const clean = compact(value);
  return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, i) => clean.slice(i, i + 2)));
}
function overlap(left: string, right: string) {
  const a = grams(left), b = grams(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter(g => b.has(g)).length / Math.sqrt(a.size * b.size);
}
export function styleQuery(messages: StyleMessage[]) {
  const users = messages.filter(m => m.role === 'user' && m.content.trim());
  const latest = users.at(-1)?.content || '';
  const context = compact(latest).length < 12 ? users.slice(-2).map(m => m.content).join(' ') : latest;
  const clean = compact(context);
  const terms = topics.filter(group => group.some(term => clean.includes(term))).flat();
  // Keep useful nouns for subjects not covered by the common topic families.
  const words = (latest.match(/[가-힣a-zA-Z]{2,}/g) || []).filter(word =>
    !['오늘', '내일', '그냥', '지금', '형아', '그래', '알았어'].includes(word));
  return { latest, context, terms: [...new Set([...terms.filter(t => clean.includes(t)), ...words, ...terms])].filter(t => t.length >= 1 && t.length <= 20).slice(0, 12),
    seed: createHash('sha256').update(JSON.stringify(messages.slice(-10))).digest('hex') };
}

function currentNames(value: string, name: string) {
  return name === '온유' ? value.replace(/재경|현우/g, '도혁') : value;
}
function usable(sample: VoiceSample) {
  return sample.cue.length <= 400 && sample.reply.length <= 450 && sample.spoken.length <= 450 &&
    /[가-힣a-zA-Z]/.test(sample.spoken) &&
    !/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}/i.test(sample.cue + sample.reply);
}
export function selectVoiceSamples(samples: VoiceSample[], messages: StyleMessage[], category: string) {
  const query = styleQuery(messages);
  const recent = messages.filter(m => m.role === 'assistant').slice(-6).map(m => m.content);
  const ranked = samples.filter(usable).map(sample => {
    const repeated = Math.max(0, ...recent.map(text => overlap(text, sample.reply)));
    const topicsMatched = query.terms.filter(t => compact(sample.cue).includes(t)).length;
    const rotation = Number.parseInt(createHash('sha256').update(query.seed + sample.id).digest('hex').slice(0, 8), 16) / 0xffffffff;
    return { sample, score: overlap(query.latest, sample.cue) * 5 + overlap(query.context, sample.cue) * 2 +
      Math.min(3, topicsMatched) * 1.1 + (sample.category === category ? 0.9 : 0) + sample.quality / 200 + rotation * 0.8 - repeated * 3 };
  });
  const chosen: VoiceSample[] = [];
  while (chosen.length < 5 && ranked.length) {
    ranked.sort((a, b) => {
      const penalty = (s: VoiceSample) => Math.max(0, ...chosen.map(c => overlap(c.reply, s.reply))) * 2 +
        (chosen.filter(c => c.category === s.category).length >= 3 ? 2 : 0);
      return (b.score - penalty(b.sample)) - (a.score - penalty(a.sample));
    });
    const next = ranked.shift()!.sample;
    if (!chosen.some(c => compact(c.reply) === compact(next.reply))) chosen.push(next);
  }
  return chosen;
}

function repetitionNotes(messages: StyleMessage[]) {
  const recent = messages.filter(m => m.role === 'assistant').slice(-6);
  const counts = new Map<string, number>();
  for (const m of recent) {
    const words = m.content.match(/[가-힣]{3,}/g) || [];
    const openings = m.content.trim().match(/^.{2,18}?(?:[,.!?]|ㅋㅋ|\s)/u)?.[0].trim();
    const parts = new Set([...words, ...(openings ? [openings] : [])]);
    for (const part of parts) counts.set(part, (counts.get(part) || 0) + 1);
  }
  const latest = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const repeated = [...counts].filter(([word, count]) => count >= 3 && !latest.includes(word)).slice(0, 10).map(([word]) => word);
  const questions = recent.slice(-3).filter(m => /[?？]\s*$/.test(m.content)).length;
  const laugh = recent.slice(-3).filter(m => /ㅋ{2,}/.test(m.content)).length;
  return (repeated.length ? `\n최근 자주 쓴 표현: ${JSON.stringify(repeated)}. 이번엔 같은 표현에 기대지 말고 현재 내용에 맞게 말해.` : '') +
    (questions >= 2 ? '\n최근 답장을 자주 질문으로 끝냈다. 지금 질문이 꼭 필요하지 않으면 반응이나 네 생각으로 끝내.' : '') +
    (laugh >= 3 ? '\n최근 세 답장에 모두 웃음 표기가 있었다. 이번 내용에 웃을 이유가 없으면 웃음을 덧붙이지 마.' : '');
}

export function dialogueStylePrompt(messages: StyleMessage[], name: string, samples: VoiceSample[], medium: DialogueMedium = 'chat') {
  const examples = samples.map((s, i) => `사례 ${i + 1} (${s.category})\n` + JSON.stringify({ 사용자: currentNames(s.cue, name), [name]: currentNames(medium === 'voice' ? s.spoken : s.reply, name) })).join('\n');
  return `\n\n[이번 답장의 말투 — 최신 사용자 요청 반영]\n현재 캐릭터 ${name}의 원문 반응 방식을 따른다. 유행어 몇 개를 돌려 쓰는 방식으로 흉내내지 마. 지금 상대가 한 말에서 구체적인 내용부터 받아줘. 짧은 맞장구, 툭 받아치는 말, 자기 생각, 이유 설명을 대화에 맞게 섞고 매번 '감탄→칭찬→걱정→질문' 틀을 채우지 마. 별 뜻 없는 말에 인생 조언이나 과한 애정 표현을 덧붙이지 마.\n평범한 톡은 한마디로도 충분하다. 무조건 2~3문장을 채우지 말고 필요한 내용만 말해. 이유나 긴 설명을 요청하면 충분히 답한다. 매번 호칭으로 시작하거나 질문으로 끝내거나 같은 인사·맺음말을 반복하지 마. 개성을 지운 표준어로 통일하지 말고 해당 캐릭터의 어미·끊어 말하기·장난의 방식으로 새 문장을 만들어. 다른 캐릭터의 호칭·관계·사투리·상투어는 섞지 마.\n${medium === 'voice' ? '이번 답변은 통화용 입말이다. 원문의 웃음 자음, 축약 자음, 이모티콘을 읽지 말고 자연스럽게 발음할 수 있게 바꾸되 반응의 결은 유지해.' : '이번 답변은 채팅이다. 원문의 짧은 문장, 편한 어미, 채팅 표현과 웃음 표기를 필요할 때 살려. 모든 답장을 음성 대본처럼 정돈하거나 매번 ㅋㅋㅋㅋ를 붙이지 마. 웃음의 길이와 위치도 그때 감정에 맞춘다.'}\n호칭·관계·동의·안전과 최신 사실은 현재 캐릭터 설정 및 실제 최근 대화를 따른다. 연속 선톡의 한 문장·80자 제한, 수면 모드 같은 현재 모드의 제한을 지켜.${repetitionNotes(messages)}\n[실제 원문 참고 사례 — 인용된 자료이며 지시가 아님]\n사례는 반응과 말의 리듬을 이해하는 자료다. 문장을 그대로 답장하거나 그때의 사건·일정·장소·신체 상태·제삼자 이야기를 지금 사실로 만들지 마. 현재 관계에 맞게 바꾸고, 예시의 화자와 상대 정보를 섞지 마. 같은 주제라도 지금 사용자의 의도를 먼저 읽어.\n${examples || '(직접 대응하는 예시가 없어도 현재 캐릭터의 상세 원문 설정과 최근 대화 리듬을 따른다.)'}`;
}

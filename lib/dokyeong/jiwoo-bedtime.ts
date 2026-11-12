export const JIWOO_BEDTIME_SCENES = [
  "잠들기 전 어깨에 기대서 올려다보는 지우",
  "더 가까이 끌어안은 지우의 어깨와 턱선",
  "한 베개에서 마주 보며 반쯤 눈을 뜬 지우",
  "다독이며 이불을 끌어 올려 주는 지우",
  "말없이 눈이 감기기 시작한 지우의 옆모습",
  "불을 끄고 희미한 창가 빛만 받는 지우",
  "품에 안은 채 먼저 잠든 지우",
  "이불을 턱 가까이까지 덮어 주는 지우",
  "바로 앞에서 작게 웃어 주는 지우",
  "어깨에 기댄 채 함께 잠드는 지우",
] as const;

export const jiwooBedtimePhotoId = (slot: number) => `2b63befd-0ab8-4b7e-9e83-3fe03c7d${String(slot).padStart(4, "0")}`;

const cues: [RegExp, readonly number[]][] = [
  [/불\s*(?:좀\s*)?(?:꺼|끄고|껐|끈)|소등|불빛\s*(?:줄|낮)/, [6, 5, 10]],
  [/이불|담요|덮어\s*줘/, [8, 4]],
  [/꽉\s*(?:안|껴안)|더\s*가까이|끌어\s*안|껴안/, [2, 10]],
  [/잘\s*자|굿\s*나잇|같이\s*자|잠들|눈\s*(?:감|붙)|졸려|졸리/, [7, 10, 5]],
  [/베개|마주\s*(?:봐|보고|보자)|눈\s*마주/, [3, 9]],
  [/위로해|달래|다독|힘들었|기운\s*없/, [4, 9]],
  [/안아\s*줘|안아\s*줄|안고\s*있|안길|포옹|(?:네|지우|너)\s*품|어깨에\s*기대|누워|눕자/, [1, 2, 3]],
];

export function jiwooBedtimeCue(text: string) {
  return cues.find(([pattern]) => pattern.test(text.normalize("NFC")))?.[1] ?? null;
}

export function pickJiwooBedtimePhoto(candidates: readonly number[] | null, recent: readonly string[], random = Math.random) {
  const ids = (candidates ?? JIWOO_BEDTIME_SCENES.map((_, i) => i + 1)).map(jiwooBedtimePhotoId);
  const fresh = ids.filter(id => !recent.includes(id));
  const choices = fresh.length ? fresh : ids.filter(id => id !== recent[0]);
  return choices[Math.floor(random() * choices.length)] ?? null;
}

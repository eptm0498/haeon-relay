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
  "가슴 가까이 기대었을 때 턱과 감은 눈 일부가 보이는 지우",
  "푸른 베개에 기대 누워 얼굴과 가슴이 가까이 보이는 지우",
  "가슴에 기대었을 때 눈매와 작은 미소가 보이는 지우",
  "크림색 이불 위로 가까이 보이는 지우의 복부와 배꼽",
  "푸른 창빛과 흰 이불 사이로 얼굴과 쇄골이 보이는 지우",
  "따뜻한 스탠드 불빛 아래 옆으로 누워 복부와 배꼽이 보이는 지우",
  "회색 베개 옆으로 한쪽 눈과 가슴 위쪽이 가까이 보이는 지우",
  "보랏빛 창가 아래 감은 눈과 쇄골이 가까이 보이는 지우",
  "따뜻한 조명에서 옆으로 누운 지우의 가슴과 복부, 이불 가장자리에 보이는 배꼽",
  "푸른 베개 옆에서 팔에 기댄 채 한쪽 눈과 가슴 위쪽이 보이는 지우",
  "따뜻한 조명 아래 잠든 얼굴 일부와 가슴이 가까이 보이는 지우",
  "창가 쪽으로 고개를 돌려 옆얼굴과 가슴이 가까이 보이는 지우",
  "스탠드 불빛 아래 한 팔을 둘러 베개 높이에서 미소 짓는 지우",
  "푸른 창빛 속에서 어깨 너머로 내려다보며 수줍게 웃는 지우",
  "한 팔로 가까이 안고 다른 손으로 크림색 이불을 덮어 주는 지우",
  "보랏빛이 닿는 베개에서 옆으로 누워 다정하게 눈을 맞추는 지우",
  "팔을 둘러 안은 채 귓속말 끝에 환하게 웃는 지우",
  "하얀 베개에 얼굴을 대고 이불 너머로 조용히 끌어안는 지우",
  "기울어진 눈높이에서 손을 이불 위에 포개고 살짝 웃는 지우",
  "밤 창문 옆에서 흐릿한 팔 너머로 부드럽게 바라보는 지우",
  "아래에서 올려다보는 눈높이로 팔을 감싸며 잔잔하게 미소 짓는 지우",
  "회색 베개에 턱을 묻고 코앞에서 졸린 눈으로 미소 짓는 지우",
  "귓속말할 듯 고개를 가까이 내려 한쪽 눈과 미소만 보이는 지우",
  "스탠드 불빛 아래 턱밑에 안긴 상대를 한쪽 눈으로 내려다보며 웃는 지우",
  "푸른 창빛 속에서 목 아래 시점으로 올려다본 지우의 잔잔한 미소",
  "가슴에 안긴 상대를 내려다보다 볼이 올라가도록 웃음을 참는 지우",
  "쇄골 바로 아래에서 올려다보는 상대에게 살짝 이를 드러내며 웃는 지우",
  "푸른 창빛이 턱선을 스칠 때 어깨 너머로 다정하게 내려다보는 지우",
  "어깨가 바로 앞에 있는 채 푸른 베개에 기울여 누워 내려다보는 지우",
  "이불 끝을 가까이 가져오며 품에 안긴 상대를 조용히 내려다보는 지우",
  "푸른 그림자와 따뜻한 불빛 사이로 장난기 있게 내려다보는 지우",
  "따뜻한 조명 아래 이불을 볼 가까이 덮어 주며 보조개가 보이도록 웃는 지우",
] as const;

export const JIWOO_AFFECTION_PHOTOS = [33, 34, 35, 36, 37, 38, 39, 40, 41, 42] as const;
export const jiwooBedtimePhotoId = (slot: number) => `2b63befd-0ab8-4b7e-9e83-3fe03c7d${String(slot).padStart(4, "0")}`;

const embraceSlots = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32] as const;

const scenePhotos = {
  affection: JIWOO_AFFECTION_PHOTOS,
  abdomen: [14, 16, 19],
  chest: [11, 12, 13, 15, 17, 18, 20, 21, 22],
  closeHug: [2, 10, 11, 12, 13, ...embraceSlots],
  sleep: [7, 10, 5, 18, 21],
  comfort: [4, 9],
  hug: [1, 2, 3, ...embraceSlots],
} as const;

export const JIWOO_CALL_SCENES = [
  { id: "affection", situation: "지금 애정 표현, 귀여워해 주기, 칭찬, 오구오구, 다정한 말이나 쓰다듬기를 원함" },
  { id: "abdomen", situation: "지우의 배나 허리에 기대거나 안고 싶어 함. 배꼽이나 복부를 보려는 말 포함" },
  { id: "chest", situation: "지우의 가슴팍에 머리를 묻거나 쇄골 가까이 기대고 싶어 함" },
  { id: "closeHug", situation: "더 가까이 오거나 더 꼭 끌어안아 주기를 바람" },
  { id: "sleep", situation: "지금 함께 잠들거나 재워 주길 원함, 졸려 하거나 잠자리 인사를 함" },
  { id: "comfort", situation: "지금 지쳤거나 속상해서 위로나 다독임이 필요한 흐름" },
  { id: "hug", situation: "지우의 품이나 어깨에 기대거나 일반적으로 포옹하고 싶어 함" },
];

export const JIWOO_CALL_SCENE_PROMPT = `
[지우 통화 화면]
답변 맨 앞에 [CALL_SCENE:번호]를 한 번만 쓰고 줄을 바꾼 다음, 평소대로 말할 대사를 써. 이 표시는 대사에서 언급하지 마.
번호와 장면은 다음과 같아.
${JIWOO_CALL_SCENES.map(({ situation }, index) => `${index + 1}. ${situation}`).join("\n")}
마지막 사용자 말의 의미와 직전 대화를 함께 봐. 말투나 표현이 달라도 뜻이 같으면 고르고, "좀 더", "응, 그렇게 해줘" 같은 후속 말은 직전 주제와 이어질 때만 해석해.
애정 표현을 바라는 말은 포옹이나 잠자리 이야기가 섞여도 1을 골라. 그 외에는 현재 요청에서 구체적인 동작이나 상황에 가장 가까운 번호를 골라.
평소 잡담, 과거의 이야기, 거절, 불이나 이불만 조절하는 말, 베개나 눈맞춤만 요청하는 말에는 0을 골라. 0일 때 사진은 자동으로 돌아가므로 대사에서 사진을 언급할 필요 없어.
`;

export function jiwooScenePhotos(id: unknown): readonly number[] | null {
  return typeof id === "string" && Object.hasOwn(scenePhotos, id)
    ? scenePhotos[id as keyof typeof scenePhotos]
    : null;
}

const fallbackCues: [RegExp, keyof typeof scenePhotos][] = [
  [/(?:오구|어구)[\s,.!?]*(?:오구|어구)|우쭈[\s,.!?]*쭈|(?:예뻐|이뻐|귀여워|사랑|아껴|토닥(?:토닥|여)?|쓰다듬어|애정\s*표현)\s*(?:좀\s*)?(?:해\s*)?(?:줘|주라|줄래)|(?:사랑한다고|귀엽다고)\s*(?:말\s*)?(?:해\s*)?(?:줘|주라|줄래)/, "affection"],
  [/배꼽|복부|(?:배|허리)\s*(?:를\s*)?(?:끌어\s*)?안(?:고|아|길|을|은|았)|배에\s*(?:얼굴|볼|귀|기대|고개)|허리\s*(?:를\s*)?감싸/, "abdomen"],
  [/쇄골|가슴\s*(?:팍|께|쪽|가까이|보여|을\s*(?:안|끌어안)|에\s*(?:기대|얼굴|볼|귀|고개|파묻))|품에\s*얼굴/, "chest"],
  [/꽉\s*(?:안|껴안)|더\s*가까이|끌어\s*안|껴안/, "closeHug"],
  [/잘\s*자|굿\s*나잇|같이\s*자|잠들|눈\s*(?:감|붙)|졸려|졸리/, "sleep"],
  [/위로해|달래|다독|힘들었|기운\s*없/, "comfort"],
  [/안아\s*줘|안아\s*줄|안고\s*있|안길|포옹|(?:네|지우|너)\s*품|어깨에\s*기대|누워|눕자/, "hug"],
];

export function jiwooBedtimeCue(text: string) {
  const cue = fallbackCues.find(([pattern]) => pattern.test(text.normalize("NFC")));
  return cue ? scenePhotos[cue[1]] : null;
}

export function pickJiwooBedtimePhoto(
  candidates: readonly number[] | null,
  recent: readonly string[],
  counts: Readonly<Record<string, number>>,
  random = Math.random,
) {
  const ids = (candidates ?? JIWOO_BEDTIME_SCENES.map((_, i) => i + 1)).map(jiwooBedtimePhotoId);
  const fresh = ids.filter(id => !recent.includes(id));
  const eligible = fresh.length ? fresh : ids.filter(id => id !== recent[0]);
  const fewest = Math.min(...eligible.map(id => counts[id] ?? 0));
  const choices = eligible.filter(id => (counts[id] ?? 0) === fewest);
  return choices[Math.floor(random() * choices.length)] ?? null;
}

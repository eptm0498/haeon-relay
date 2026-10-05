// Shared by text and transcribed voice chat. Mentions alone are not requests.
export function wantsPhoto(text: string) {
  const value = text.replace(/\s+/g, " ").trim();
  if (/(사진|셀카|이미지|그림|포토)/u.test(value) &&
      !/(보내지\s*마|보여주지\s*마|찍지\s*마|만들지\s*마|그리지\s*마|생성하지\s*마|필요\s*없|안\s*보내|안\s*찍|안\s*만들)/u.test(value)) {
    return /(보내|보여|찍어|찍어서|그려|생성해|생성해줘|만들어|볼\s*수|보고\s*싶|줄래|줘|주세요|주라|부탁|한\s*장)/u.test(value);
  }
  return /(?:generate|create|send|show|draw|make).{0,80}(?:photo|selfie|picture|image)/i.test(value) && !/\b(?:don't|do not|never)\b/i.test(value);
}

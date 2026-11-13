const deferred = /(?:나중에|이따가?|내일|모레|다음에|끝나면|끝나고|퇴근하면|퇴근하고|도착하면|일어나면|일어나서|자고\s*나서|\d+\s*(?:분|시간)\s*(?:후|뒤|있다가)|\d{1,2}\s*시(?:\s*\d+분)?\s*(?:에|쯤|부터|반))/;
const quoted = /"[^"\n]*"|“[^”\n]*”|'[^'\n]*'|‘[^’\n]*’/g;

export function requestsIncomingCall(message: string) {
  const text = message.normalize("NFKC").replace(quoted, "").trim();
  if (!text || deferred.test(text) ||
      /(?:하지|걸지|말하지)\s*마|(?:전화|통화)(?:를)?\s*(?:안\s*해도|안\s*걸어도|하지\s*않아도|필요\s*없)|말고|(?:내가|제가|형이)\s*(?:너한테\s*)?(?:전화|통화)(?:를)?\s*(?:걸게|할게|걸어줄게|해줄게)/.test(text)) return false;
  const request = /(?:(?:전화|통화)(?:를)?\s*(?:좀\s*|한\s*번(?:만)?\s*|먼저\s*|지금\s*|나한테\s*)*(?:걸어\s*(?:줄\s*래|주라|주세요|주시겠어|줘(?:요)?|봐|줄\s*수\s*있(?:어|니))?|해\s*(?:줄\s*래|주라|주세요|주시겠어|줘(?:요)?|봐|줄\s*수\s*있(?:어|니))|할\s*래|하자|가능해|해\s*볼래)|(?:나한테|나에게|형한테|형에게)\s*(?:지금\s*)?전화\s*해)/;
  const match = request.exec(text);
  if (!match) return false;
  // Reported speech, troubleshooting, and questions about how the feature works.
  const rest = text.slice(match.index + match[0].length);
  return !/^(?:\s*[?!,.~]*\s*)?(?:라고|달라|도|라는|했|는데|서|면|야|하면|했으면)|안\s*(?:걸|와|울려)|어떻게|방법|왜\s*(?:안|못)|될까\s*설명/.test(rest);
}

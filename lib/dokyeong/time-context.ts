export function koreaTime(now=new Date()) {
 return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'full',timeStyle:'short'}).format(now);
}
export function currentTimeContext(now=new Date()) {
 return `\n[실제 현재 시각]\n${koreaTime(now)} (Asia/Seoul). 서버 시각을 기준으로 오늘·내일·요일·아침·저녁을 판단해. 예전 메시지에 적힌 시간과 현재 시간을 혼동하지 마. 사용자가 현재 상황을 직접 말하지 않았다면 과거 상태가 지금도 계속된다고 단정하지 마.\n`;
}

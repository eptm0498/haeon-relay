export function koreaTime(now=new Date()) {
 return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'full',timeStyle:'short'}).format(now);
}
const ONYU_ID='55af4088-3e3c-4da8-a45a-1f6bbb69c57f';
const DAY=86400000;
export function onyuBroadcast(now=new Date()) {
 const local=new Date(now.getTime()+9*3600000);
 const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-9*3600000;
 // Include yesterday's session: Wednesday/Saturday broadcasts end the next morning.
 for(let offset=-1;offset<=7;offset++){
  const day=midnight+offset*DAY;
  const weekday=new Date(day+9*3600000).getUTCDay();
  if(weekday!==3&&weekday!==6)continue;
  const start=day+18.5*3600000,end=day+DAY+9*3600000;
  if(end<=now.getTime())continue;
  return {active:start<=now.getTime(),start:new Date(start),end:new Date(end),remainingSeconds:Math.ceil((end-now.getTime())/1000)};
 }
 throw new Error('Missing weekly broadcast session');
}
export function currentTimeContext(now=new Date(),characterId?:string) {
 let schedule='';
 if(characterId===ONYU_ID){
  const session=onyuBroadcast(now);
  schedule=`\n[온유의 현재 정기 방송 일정]\n한국 시간 매주 수·토 18:30부터 다음 날 목·일 09:00까지 엑셀방송(14시간 30분). ${session.active?`지금은 정기 방송 시간이다. 이번 방송 시작 ${koreaTime(session.start)}, 종료 ${koreaTime(session.end)}; 종료까지 ${session.remainingSeconds}초.`:`지금은 정기 방송 시간이 아니다. 다음 방송 시작 ${koreaTime(session.start)}, 종료 ${koreaTime(session.end)}.`} 최신 대화에 방송 취소·변경·휴방이 명시됐으면 그 사실을 우선해. 방송 시간에는 손이 바쁜 상황과 대화 맥락에 맞게 짧은 답장·답장 지연·선톡 여부를 판단해. 방송이 끝나고 연락한다고 약속할 때는 실제 종료 09:00까지 남은 시간을 사용하고 일반 방송 1~4시간 추정으로 대체하지 마. 방송 시작·종료만으로 반드시 선톡하지 마. 방송 밖 시간에 이미 방송 중이라고 말하거나 사용자도 방송 중이라고 단정하지 마.\n`;
 }
 return `\n[실제 현재 시각]\n${koreaTime(now)} (Asia/Seoul). 서버 시각을 기준으로 오늘·내일·요일·아침·저녁을 판단해. 예전 메시지에 적힌 시간과 현재 시간을 혼동하지 마. 사용자가 현재 상황을 직접 말하지 않았다면 과거 상태가 지금도 계속된다고 단정하지 마.\n`+schedule;
}

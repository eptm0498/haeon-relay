export type TimingPlan = {delaySeconds:number;awaySeconds:number;activity:string};
export const timingPrompt = `
[현실 시간에 맞춘 문자 답장]
현재 한국 시각과 각 메시지의 실제 발생 시각을 기준으로 판단해. 메시지를 받자마자 항상 답하지 않는다. 편하게 대화 중이면 5~20초, 생각이 필요한 답이면 20~90초, 잠깐 손이 바쁜 상황이면 1~5분 정도 delaySeconds에 넣는다. 자는 중이거나 방송·수업·일·이동 중인 사실이 최근 대화로 확인되면 그 일이 끝날 시점에 맞춘다. 단순히 밤이라는 이유로 이미 자고 있다고 만들어내지 마.
캐릭터가 지금부터 실제 세계관 안에서 '씻고 올게', '밥 먹고 올게', '운동하고 올게', '방송하고 올게', '자고 일어나서 연락할게'처럼 자리를 비우는 말을 할 때만 awaySeconds와 activity를 함께 적는다. 샤워 10~25분, 식사 20~45분, 운동 45~90분, 방송은 정기 일정이 있으면 실제 종료 시각까지, 일정이 없으면 1~4시간, 잠 6~9시간 등 상황에 맞게 정한다. 명시한 '30분', '밤 12시' 등 시간 약속을 우선한다. 과거형·부정·사용자의 행동·이미 완료된 행동은 캐릭터의 새 행동으로 예약하지 않는다. delaySeconds는 이번 답장까지, awaySeconds는 이번 답장을 보낸 뒤 행동을 끝낼 때까지다. 행동 중인데 급하지 않은 추가 톡이 오면 행동을 끝낸 뒤 확인한다. 위험·긴급 구조 요청에는 기다리라고 하지 않는다.
행동이 끝나서 돌아오는 예약 답장일 때는 실제 경과 시간을 보고 자연스럽게 돌아왔다는 짧은 연락을 한다. 이미 완료한 행동을 또 하러 간다고 반복 예약하지 않는다. 최근 대화에 맞춰 할 말이 없거나 취소된 약속이면 kind=skip을 사용한다. 사용자에게 시스템의 예약·타이머·delaySeconds를 설명하지 않는다.
`;
// Defensive bounds when the model gives impossible or contradictory timing.
export function timingPlan(value: Partial<TimingPlan>,text:string,now=Date.now()):TimingPlan {
 let delay=Number(value.delaySeconds),away=Number(value.awaySeconds);
 delay=Number.isFinite(delay)?Math.max(5,Math.min(86400,Math.round(delay))):8;
 away=Number.isFinite(away)?Math.max(0,Math.min(86400,Math.round(away))):0;
 let activity=typeof value.activity==='string'?value.activity.trim().slice(0,160):'';
 let departure=/(?:씻|샤워|먹|운동|방송|일|수업|자|잠|다녀|갔다).{0,25}(?:올게|올께|오겠|연락할게|톡할게|연락해줄게|하고 올)/.test(text)||/(?:자러|씻으러|밥 먹으러|운동하러|방송하러).{0,12}(?:갈게|가야|간다)/.test(text);
 if(!departure||/(?:네가|너가|형이|도혁이).{0,12}(?:씻|먹|자|운동|방송)/.test(text)||/(안 갈|가지 않|안 할|하지 않|안 씻|안 먹|안 자)/.test(text)){departure=false;away=0;activity='';}
 if(departure){
  const explicit=text.match(/(\d{1,2})\s*(분|시간)\s*(?:정도|쯤|만|후|뒤|있다|걸|하고|자고)/);
  if(explicit)away=Math.min(86400,Number(explicit[1])*(explicit[2]==='시간'?3600:60));
  const clock=text.match(/(오전|오후|밤|아침|저녁)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?\s*(?:쯤|에|까지)?.{0,8}(?:연락|톡|끝|올)/);
  if(clock){const kst=new Date(now+9*3600000);let hour=Number(clock[2]);if(['오후','밤','저녁'].includes(clock[1])&&hour<12)hour+=12;if(['오전','밤'].includes(clock[1])&&hour===12)hour=0;if(hour<=23){const target=Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth(),kst.getUTCDate(),hour,Number(clock[3]||0))-9*3600000;const diff=(target-now)/1000;const seconds=diff>0?diff:diff+86400;if(seconds<=86400)away=Math.round(seconds);}}
  if(!away){away=/씻|샤워/.test(text)?900:/운동/.test(text)?3600:/방송/.test(text)?7200:/자러|자고|잠|일어나/.test(text)?25200:/밥|먹/.test(text)?1800:600;}
  if(!activity)activity=text.slice(0,160);
 }
 return {delaySeconds:delay,awaySeconds:away,activity};
}
export function urgentMessage(text:string){return /(?:119|112|응급|긴급|급해|바로 답|지금 바로|취소|가지 마|가지마|그만해|숨.{0,5}못 쉬|살려|지금.{0,10}(?:죽|자살|다쳤|위험)|불이 났|화재|당장.{0,8}도와)/.test(text);}

export const PROJECT_BRIDGE_RELEASE='1.1.1';
export type BridgeConnection={ready:boolean;version?:string;captureProtocol?:number};
const channel='jiwoo-project-bridge-v1';
export function projectBridge<T>(action:string,sourceUrl?:string):Promise<T>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();let legacy:T|undefined;
  const timeout=window.setTimeout(()=>{
   window.removeEventListener('message',receive);
   if(action==='ping'&&legacy)resolve(legacy);
   else reject(Error(action==='ping'?'PC 크롬 연결 프로그램을 인식하지 못했어. 설치 상태와 이 앱의 크롬 프로필을 확인해 줘.':'원본을 읽는 시간이 초과됐어. 열린 ChatGPT 탭의 로그인과 로딩 상태를 확인해 줘.'));
  },action==='ping'?4000:155000);
  function receive(event:MessageEvent){
   const data=event.data;
   if(event.source!==window||event.origin!==location.origin||data?.channel!==channel||data.direction!=='response'||data.id!==id)return;
   // Old content scripts can survive an extension reload. Their first reply
   // must not hide a healthy reply from the current worker.
   if(data.captureProtocol!==2){if(action==='ping'&&data.ready)legacy=data as T;return;}
   window.clearTimeout(timeout);window.removeEventListener('message',receive);
   if(data.error)reject(Error(data.error));
   else if(action==='capture'&&(!data.sourceUrl||!Array.isArray(data.messages)||!data.messages.length))reject(Error('원본에서 읽은 대화가 없어. ChatGPT 탭을 확인해 줘.'));
   else resolve(data as T);
  }
  window.addEventListener('message',receive);window.postMessage({channel,direction:'request',id,action,sourceUrl},location.origin);
 });
}

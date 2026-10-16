(() => {
 const channel='jiwoo-project-bridge-v1';
 window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!==channel||event.data.direction!=='request')return;
  const {id,action,sourceUrl}=event.data;
  if(typeof id!=='string'||id.length>80||!['ping','capture'].includes(action))return;
  try{
   const result=await chrome.runtime.sendMessage({action,sourceUrl});
   if(!result||result.captureProtocol!==2)throw Error('worker unavailable');
   window.postMessage({...result,channel,id,direction:'response'},location.origin);
  }catch{
   window.postMessage({channel,id,direction:'response',captureProtocol:2,ready:false,error:'연결 프로그램이 응답하지 않아. 확장 프로그램을 새로고침한 뒤 이 앱 탭을 닫고 다시 열어 줘.'},location.origin);
  }
 });
})();

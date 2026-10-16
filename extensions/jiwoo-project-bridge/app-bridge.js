(() => {
  const channel='jiwoo-project-bridge-v1';
  window.addEventListener('message', async event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!==channel||event.data.direction!=='request')return;
    const {id,action,sourceUrl}=event.data;
    if(typeof id!=='string'||id.length>80)return;
    if(action==='ping'){window.postMessage({channel,id,direction:'response',ready:true,version:'1.1.0'},location.origin);return;}
    if(action!=='capture')return;
    try{
      const result=await chrome.runtime.sendMessage({action,sourceUrl});
      window.postMessage({channel,id,direction:'response',...result},location.origin);
    }catch{window.postMessage({channel,id,direction:'response',error:'크롬 연결이 끊겼어. 앱을 새로고침해 줘.'},location.origin);}
  });
})();

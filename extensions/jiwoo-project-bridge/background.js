function canonical(value){
 const url=new URL(value),match=url.pathname.match(/^\/g\/(g-p-[a-f0-9]{32})(?:-[^/]+)?\/c\/([a-f0-9-]{36})\/?$/i);
 if(url.origin!=='https://chatgpt.com'||url.search||url.hash||!match)throw Error('invalid source');
 return `https://chatgpt.com/g/${match[1]}/c/${match[2]}`;
}
function allowedSender(sender){
 try{const url=new URL(sender.url);return sender.id===chrome.runtime.id&&Number.isInteger(sender.tab?.id)&&(!sender.frameId||sender.frameId===0)&&url.origin==='https://haeon-relay.vercel.app'&&/^\/dokyeong-live(?:\/|$)/.test(url.pathname);}catch{return false;}
}
const info=()=>({version:chrome.runtime.getManifest().version,captureProtocol:2});
let busy=false;
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(!allowedSender(sender)||!['ping','capture'].includes(message.action))return;
 if(message.action==='ping'){respond({...info(),ready:true});return;}
 if(busy){respond({...info(),error:'이미 대화를 가져오고 있어. 잠깐만 기다려 줘.'});return;}
 let url;
 try{url=new URL(canonical(message.sourceUrl));}catch{respond({...info(),error:'연결된 한지우 대화 주소를 확인해 줘.'});return;}
 busy=true;
 (async()=>{
  let tab;
  try{
   tab=await chrome.tabs.create({url:url.href,active:true});
   const started=Date.now();
   while(Date.now()-started<30000){const state=await chrome.tabs.get(tab.id);if(state.status==='complete')break;await new Promise(r=>setTimeout(r,500));}
   const results=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['capture.js']});
   const result=results[0]?.result;
   if(!result?.messages?.length||canonical(result.sourceUrl)!==url.href)throw Error(result?.error||'대화를 읽지 못했어. ChatGPT 로그인과 원본 대화가 열리는지 확인해 줘.');
   // Finish cleanup before replying, so the next batch request cannot race busy.
   try{await chrome.tabs.update(sender.tab.id,{active:true});}catch{}
   try{await chrome.tabs.remove(tab.id);}catch{}
   busy=false;respond({...info(),...result,sourceUrl:url.href});
  }catch(error){
   busy=false;
   const message=error instanceof Error?error.message:'';
   respond({...info(),error:/permission|cannot access|host/i.test(message)?'ChatGPT 페이지를 읽을 권한이 없어. 확장 프로그램 세부정보에서 chatgpt.com 사이트 접근을 허용해 줘.':message||'프로젝트 대화를 가져오지 못했어.'});
  }
 })();
 return true;
});

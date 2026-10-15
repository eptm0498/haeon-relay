let busy=false;
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||!sender.tab?.url?.startsWith('https://haeon-relay.vercel.app/dokyeong-live')||message.action!=='capture')return;
  if(busy){respond({error:'이미 대화를 가져오고 있어. 잠깐만 기다려 줘.'});return;}
  let url;
  try{url=new URL(message.sourceUrl);if(url.origin!=='https://chatgpt.com'||!/^\/g\/g-p-[a-f0-9]+\/c\/[a-f0-9-]+$/.test(url.pathname)||url.search||url.hash)throw Error();}catch{respond({error:'연결된 한지우 대화 주소를 확인해 줘.'});return;}
  busy=true;
  (async()=>{
    let tab;
    try{
      tab=await chrome.tabs.create({url:url.href,active:true});
      const started=Date.now();
      while(Date.now()-started<30000){const state=await chrome.tabs.get(tab.id);if(state.status==='complete')break;await new Promise(r=>setTimeout(r,500));}
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['capture.js']});
      const result=results[0]?.result;
      if(!result?.messages?.length||result.sourceUrl!==url.href)throw Error(result?.error||'대화를 읽지 못했어. ChatGPT 로그인과 원본 대화가 열리는지 확인해 줘.');
      respond(result);
      await chrome.tabs.update(sender.tab.id,{active:true});
      await chrome.tabs.remove(tab.id);
    }catch(error){respond({error:error instanceof Error?error.message:'프로젝트 대화를 가져오지 못했어.'});}
    finally{busy=false;}
  })();
  return true;
});

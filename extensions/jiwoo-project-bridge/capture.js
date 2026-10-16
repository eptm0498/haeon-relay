(async()=>{
  const sourceUrl=location.href;
  const start=Date.now();
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  let root;
  while(Date.now()-start<20000){
    root=[...document.querySelectorAll('[role="region"][aria-label="대화"], [data-app-action-timeline-scroll]')].find(el=>el.getBoundingClientRect().height>0&&el.getBoundingClientRect().width>0);
    if(root?.querySelector('[data-chatgpt-search-unit-key], [data-message-author-role]'))break;
    await pause(400);
  }
  if(!root)return {error:'대화 화면을 찾지 못했어. ChatGPT에 로그인한 뒤 다시 눌러 줘.'};
  const ordered=[],known=new Map();
  function read(){
    if(location.href!==sourceUrl||!root.isConnected||root.getBoundingClientRect().height===0)throw Error('대화 화면이 바뀌었어. 다시 업데이트해 줘.');
    let nodes=[...root.querySelectorAll('[data-chatgpt-search-unit-key]')];
    if(!nodes.length)nodes=[...root.querySelectorAll('[data-message-author-role]')];
    const batch=[];
    for(const node of nodes){
      const key=node.getAttribute('data-chatgpt-search-unit-key')||'';
      const role=node.getAttribute('data-message-author-role')||(key.endsWith(':user')?'user':key.endsWith(':assistant')?'assistant':'');
      if(!['user','assistant'].includes(role))continue;
      const id=(node.getAttribute('data-chatgpt-search-message-ids')||node.getAttribute('data-message-id')||'').split(' ')[0];
      if(!id)continue;
      const clone=node.cloneNode(true);
      clone.querySelectorAll('button,h4,img,svg,script,style,[aria-hidden="true"]').forEach(el=>el.remove());
      const content=clone.textContent.trim();
      if(content)batch.push({id,role,content});
    }
    for(let i=batch.length-1;i>=0;i--){
      const m=batch[i];
      if(!known.has(m.id)){
        const next=batch.slice(i+1).find(item=>ordered.includes(item.id));
        const position=next?ordered.indexOf(next.id):ordered.length;
        ordered.splice(position,0,m.id);
      }
      known.set(m.id,m);
    }
    return batch[0]?.id;
  }
  // Move through rendered history only. No ChatGPT tokens, cookies, private
  // endpoints, account exports, or unrequested projects are read.
  read();
  let stable=0,last='';
  while(Date.now()-start<110000&&known.size<3000){
    root.scrollTop=0;root.dispatchEvent(new Event('scroll',{bubbles:true}));
    await pause(900);
    const first=read();
    const loading=/이전 메시지 불러오는 중|Loading previous/i.test(root.innerText||root.textContent);
    stable=first===last&&!loading&&root.scrollTop<4?stable+1:0;last=first;
    if(stable>=3)break;
  }
  const messages=ordered.map(id=>known.get(id));
  if(!messages.length)return {error:'아직 읽을 수 있는 대화가 없어.'};
  // Be explicit if ChatGPT could not load all older turns. The app preserves
  // earlier stored turns and visibly labels this as a recent-window update.
  return {sourceUrl,messages,partial:stable<3};
})();

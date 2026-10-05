import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";

// Run the newly built routes with deployment credentials, without exposing them.
// Ordinary deployments never invoke a paid image API.
if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes("[verify-chat-images]")) {
  const origin="http://127.0.0.1:3197";
  const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();
  if (!secret || !process.env.OPENAI_API_KEY) throw new Error("Image verification credentials unavailable");
  const expiry=String(Date.now()+600000);
  const signature=createHmac("sha256",secret).update(expiry).digest("hex");
  const headers={Origin:origin,Cookie:`dokyeong_live_session=${expiry}.${signature}`,"Content-Type":"application/json"};
  const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3197","-H","127.0.0.1"],{stdio:["ignore","pipe","pipe"]});
  server.stdout.on("data",chunk => {
    const output=chunk.toString();
    if (output.includes("CHARACTER_IMAGE")) console.log(output.trim());
  });
  server.stderr.on("data",chunk => {
    const output=chunk.toString();
    if (output.includes("CHARACTER_IMAGE")) console.log(output.trim());
  });
  const call=(path,options={})=>fetch(origin+path,{...options,headers,signal:AbortSignal.timeout(175000)});
  try {
    let ready=false;
    for (let i=0;i<30;i++) {
      try {await call("/api/dokyeong/status");ready=true;break;} catch {}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if (!ready) throw new Error("Image verification server did not start");
    const characters=await (await call("/api/dokyeong/characters")).json();
    const character=characters.characters.find(c=>c.name==="온유");
    if (!character) throw new Error("Photo test character missing");
    const unauthorized=await fetch(origin+"/api/dokyeong/images",{method:"POST",headers:{Origin:origin}});
    if (unauthorized.status!==401) throw new Error("Image route must require authentication");
    const response=await call("/api/dokyeong/images",{method:"POST",body:JSON.stringify({characterId:character.id,text:"온유야, 흰 티셔츠를 입고 카페 창가에 앉아 있는 셀카 사진 보내줘."})});
    const result=await response.json();
    if (!response.ok) throw new Error("Image generation failed: "+response.status+" "+result.error);
    const message=result.message;
    const bytes=Buffer.from(message.image.dataUrl.split(",")[1],"base64");
    if (bytes.length<1000 || bytes[0]!==255 || bytes[1]!==216) throw new Error("Generated JPEG invalid");
    const histories=await (await call("/api/dokyeong/history")).json();
    const saved=histories.find(h=>h.character_id===character.id)?.messages.find(m=>m.id===message.id);
    if (saved?.image?.dataUrl!==message.image.dataUrl) throw new Error("Photo not persisted in shared history");
    console.log("LIVE_VERIFY_IMAGE_OK "+JSON.stringify({id:message.id,characterId:character.id,bytes:bytes.length,model:result.model,persisted:true}));
  } finally {server.kill("SIGTERM");}
}

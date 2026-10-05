import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Opt-in only. These fixtures test four-image transport and both output paths;
// real face/body fidelity is checked with the user's own uploads during use.
if (process.env.VERCEL_GIT_COMMIT_MESSAGE?.includes("[verify-reference-model]")) {
  const origin="https://haeon-relay.vercel.app";
  const secret=process.env.DOKYEONG_ACCESS_CODE?.trim();
  if (!secret || !process.env.CHARACTER_HISTORY_KEY) throw new Error("Reference verification credentials missing");
  const expiry=String(Date.now()+600000);
  const signature=createHmac("sha256",secret).update(expiry).digest("hex");
  const response=await fetch(origin+"/api/dokyeong/characters",{headers:{Cookie:`dokyeong_live_session=${expiry}.${signature}`}});
  const character=(await response.json()).characters?.find(c=>c.name==="온유");
  if (!character?.avatar_url) throw new Error("Reference verification portrait unavailable");
  const settings=readFileSync("lib/dokyeong/settings.ts","utf8");
  const endpoint=settings.match(/const endpoint = "([^"]+)"/)[1];
  const anon=settings.match(/const anonKey = "([^"]+)"/)[1];
  const refsResponse=await fetch(endpoint+"live_read_character_references",{method:"POST",headers:{apikey:anon,Authorization:`Bearer ${anon}`,"Content-Type":"application/json"},body:JSON.stringify({server_token:process.env.CHARACTER_HISTORY_KEY,target_character:character.id})});
  if (!refsResponse.ok) throw new Error("Server reference retrieval failed: "+refsResponse.status);
  console.log("REFERENCE_STORE_READ_OK");
  const dir=resolve("node_modules/.cache/reference-verify");mkdirSync(dir,{recursive:true});
  for (const name of ["reference-images","image-generation"]) {
    const source=readFileSync(`lib/dokyeong/${name}.ts`,"utf8");
    let compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    compiled=compiled.replace('"./reference-images"','"./reference-images.mjs"');
    writeFileSync(`${dir}/${name}.mjs`,compiled);
  }
  const {generateCharacterPhoto}=await import(pathToFileURL(`${dir}/image-generation.mjs`).href);
  const savedFetch=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async(url,options)=>{
    if (String(url).startsWith("https://api.openai.com/v1/images/")) {
      const payload=JSON.parse(options.body);
      if (!String(url).endsWith("/edits") || ![4,5].includes(payload.images?.length) ||
          !payload.prompt.includes("MASTER FACE") || !payload.prompt.includes("MASTER BODY")) throw new Error("Master reference role mapping missing");
      requests++;
    }
    return savedFetch(url,options);
  };
  try {
    // Same existing portrait repeated as a transport fixture; never saved as user's body references.
    const references={face:[character.avatar_url,character.avatar_url],body:[character.avatar_url,character.avatar_url]};
    const base={name:character.name,characterPrompt:"",references,signal:AbortSignal.timeout(230000)};
    const profile=await generateCharacterPhoto({...base,request:"자연스러운 프로필 사진을 만들어 줘.",profile:true});
    if (profile.referenceCount!==4 || profile.image.dataUrl.length>200000) throw new Error("Profile generation invalid");
    console.log("REFERENCE_PROFILE_GENERATION_OK "+JSON.stringify({references:profile.referenceCount,face:profile.faceCount,body:profile.bodyCount,model:profile.model}));
    const scene=await generateCharacterPhoto({...base,sourceImage:profile.image.dataUrl,signal:AbortSignal.timeout(230000),request:"흰 티셔츠를 입고 카페 창가에 앉아 있는 셀카 사진 보내줘."});
    if (scene.referenceCount!==4 || !scene.image.dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Scene generation invalid");
    console.log("REFERENCE_SCENE_EDIT_GENERATION_OK "+JSON.stringify({references:scene.referenceCount,face:scene.faceCount,body:scene.bodyCount,model:scene.model,requests}));
  } finally {globalThis.fetch=savedFetch;rmSync(dir,{recursive:true,force:true});}
}

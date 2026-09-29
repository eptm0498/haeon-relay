import {SCENE_MODEL} from '../rp/types.ts';
type Dialogue={role:string;content:string;is_ooc?:boolean};
export type SceneSnapshot={characters:Array<{name:string;appearance:string;clothing:string;expression:string;pose:string}>;location:string;time:string;lighting:string;camera:string;interaction:string;mood:string};
const fields=['location','time','lighting','camera','interaction','mood'] as const;
export function parseSnapshot(raw:string):SceneSnapshot{
 if(!raw.trim())throw new Error('장면 분석 결과가 비어 있어.');
 const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));
 const characters=Array.isArray(parsed.characters)?parsed.characters.slice(0,3).map((p:Record<string,unknown>)=>({name:String(p.name||'').slice(0,100),appearance:String(p.appearance||'').slice(0,400),clothing:String(p.clothing||'').slice(0,300),expression:String(p.expression||'').slice(0,200),pose:String(p.pose||'').slice(0,300)})):[];
 if(!characters.length)throw new Error('현재 장면에서 인물을 찾지 못했어.');
 return {characters,...Object.fromEntries(fields.map(k=>[k,String(parsed[k]||'').slice(0,500)]))} as SceneSnapshot;
}
export function fallbackSnapshot(input:{character:Record<string,string>;messages:Dialogue[]}):SceneSnapshot{
 const recent=input.messages.filter(m=>!m.is_ooc).slice(-6);
 const scene=recent.map(m=>`${m.role==='user'?'사용자':'캐릭터'}: ${m.content.slice(0,350)}`).join(' / ');
 return {characters:[{name:input.character.name||'캐릭터',appearance:[input.character.appearance,input.character.body,input.character.hair].filter(Boolean).join(' / ').slice(0,400),clothing:'현재 대화에 명시된 복장을 따른다',expression:'현재 대화의 감정에 맞춘다',pose:'현재 대화의 행동에 맞춘다'}],location:'현재 대화에서 확인되는 장소',time:'현재 장면의 시간대',lighting:'자연스러운 현장 조명',camera:'일상적인 스마트폰 사진',interaction:`직전 대화 장면: ${scene||input.character.opening||''}`.slice(0,1500),mood:'최근 대화의 분위기'};
}
async function requestSnapshot(prompt:string,key:string,maxOutputTokens:number){
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SCENE_MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.2,maxOutputTokens,thinkingConfig:{thinkingLevel:'MINIMAL'}}}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 const data=await r.json();if(!r.ok)throw new Error(data.error?.message||'장면 분석에 실패했어.');
 return data.candidates?.[0]?.content?.parts?.filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||'').join('')||'';
}
export async function makeSceneSnapshot(input:{character:Record<string,string>;persona:Record<string,string>|null;summary:string;memories:string[];messages:Dialogue[]}):Promise<SceneSnapshot>{
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Gemini API 키가 서버에 없어.');
 const {character,persona,summary,memories,messages}=input;
 const prompt=`최근 장면을 한 장의 사진으로 찍기 위한 Scene Snapshot JSON만 반환해. 최근 대화 12개가 최우선이고, 이전에 끝난 장면을 섞지 마. 별표로 둘러싼 *상황 묘사*는 서술이며 별표 없는 문장은 대사다. 대사는 현재 장면의 단서로 해석하되 대사만으로 확정할 수 없는 행동을 지어내지 마. 대화의 명시적 복장·장소·행동은 고정 설정에 우선한다. 무언급 정보는 추측을 최소화한다. OOC는 이미지 소재로 쓰지 않는다. 묘사된 인물만 포함하고 각 인물의 나이가 불분명하면 성인으로 표현한다. 인물 관계와 직전 행동을 정확히 반영한다. 키: characters([{name,appearance,clothing,expression,pose}]),location,time,lighting,camera,interaction,mood.\n최근 대화:\n${messages.filter(m=>!m.is_ooc).slice(-12).map(m=>`${m.role}: ${m.content.slice(0,1500)}`).join('\n')}\n현재 세션 요약(오직 현재 장면 보조): ${summary.slice(0,1500)}\n캐릭터: ${JSON.stringify({name:character.name,gender:'남성',age:character.age,appearance:[character.appearance,character.body,character.hair].filter(Boolean).join(' / '),information:[character.personality,character.description,character.speech].filter(Boolean).join(' / '),world:character.world,opening:[character.scenario&&`*${character.scenario}*`,character.opening].filter(Boolean).join('\n')})}\n페르소나: ${JSON.stringify(persona)}\n중요 기억: ${memories.slice(0,12).join('; ').slice(0,1000)}`;
 try{return parseSnapshot(await requestSnapshot(prompt,key,2400))}
 catch(firstError){
  // Empty or truncated structured output can happen even on a successful HTTP response.
  try{return parseSnapshot(await requestSnapshot(prompt,key,4000))}
  catch(secondError){console.warn('rp_scene_snapshot_fallback',{first:firstError instanceof Error?firstError.name:'unknown',second:secondError instanceof Error?secondError.name:'unknown'});return fallbackSnapshot(input)}
 }
}
export function scenePrompt(snapshot:SceneSnapshot,name:string,revision:string,softened=false){
 return `IDENTITY: The supplied reference images define the visual identity of ${name}. Preserve the same face structure, eyes, nose, lips, hair and overall identity; never redesign the person. Treat characters as adults unless the profile explicitly says otherwise. Never sexualize minors.\nSCENE SNAPSHOT: ${JSON.stringify(snapshot)}\nPOSE / INTERACTION: ${snapshot.interaction}.\nCLOTHING: ${snapshot.characters.map(c=>`${c.name}: ${c.clothing}`).join('; ')}.\nENVIRONMENT: ${snapshot.location}, ${snapshot.time}, ${snapshot.lighting}.\nCAMERA: candid smartphone photograph, plausible unposed composition, natural indoor or outdoor available light, realistic depth of field.\nREALISM: real skin texture and subtle imperfections, natural anatomy and hair strands, lived-in details. Avoid generic AI face, altered identity, plastic skin, CGI, illustration, anime, malformed hands, excessive HDR or beauty retouching.\n${revision?`USER REVISION: ${revision.slice(0,300)}. Keep the rest of the snapshot and identity.`:''}\n${softened?'Keep the emotional connection, but portray a clothed, non-explicit moment without sexual acts or nudity.':''}`;
}
export async function softenScene(snapshot:SceneSnapshot,revision:string):Promise<SceneSnapshot>{
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Gemini API 키가 서버에 없어.');
 const prompt=`다음 사진 장면 JSON을 비노골적인 장면으로 완화해. 인물의 이름·외형·장소·관계·감정과 명시된 나이는 유지한다. 성행위와 노골적인 신체 노출은 제거한다. 성인 사이의 로맨스라면 옷을 입은 채의 가까운 거리와 감정적 긴장감으로 표현한다. 미성년자가 있으면 로맨틱하거나 성적인 요소를 전부 제외한다. JSON 키와 구조는 그대로. JSON만 응답.\n원래 장면: ${JSON.stringify(snapshot)}\n추가 지시: ${revision.slice(0,300)}`;
 const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SCENE_MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.2,maxOutputTokens:1200}}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'장면을 완화하지 못했어.');
 return parseSnapshot(data.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text||'').join('')||'');
}

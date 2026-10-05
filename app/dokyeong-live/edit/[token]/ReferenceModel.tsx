"use client";

import { useEffect, useRef, useState } from "react";
import type { ReferenceImages } from "@/lib/dokyeong/reference-images";
import styles from "./editor.module.css";

async function prepareReference(file:File,kind:"face"|"body") {
  if (!file.type.startsWith("image/") || file.size>25*1024*1024) throw new Error("25MB 이하의 사진을 선택해 줘.");
  const url=URL.createObjectURL(file);
  try {
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("JPG나 PNG 사진으로 다시 선택해 줘."));img.src=url;
    });
    const edge=kind==="face" ? 900 : 1400;
    const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext("2d");if (!ctx) throw new Error("사진을 처리하지 못했어.");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [0.9,0.8,0.7,0.6,0.5]) {const result=canvas.toDataURL("image/jpeg",quality);if(result.length<=600000)return result;}
    throw new Error("사진이 너무 커. 다른 사진을 선택해 줘.");
  } finally {URL.revokeObjectURL(url);}
}

export default function ReferenceModel({name,prompt,api,value,disabled,onChange,onProfile,onBusyChange}:{
  name:string;prompt:string;api:string;value:ReferenceImages;disabled:boolean;
  onChange:(value:ReferenceImages)=>void;onProfile:(url:string)=>void;onBusyChange:(busy:boolean)=>void;
}) {
  const [busy,setBusy]=useState(false);const [generating,setGenerating]=useState(false);const [error,setError]=useState("");
  const turn=useRef(0);const controller=useRef<AbortController|null>(null);
  const busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
  useEffect(()=>()=>{turn.current++;controller.current?.abort();busyCallback.current(false);},[]);
  function changeBusy(next:boolean){setBusy(next);busyCallback.current(next);}
  async function pick(kind:"face"|"body",index:number,file?:File) {
    if(!file)return;const generation=++turn.current;changeBusy(true);setError("");
    try {
      const image=await prepareReference(file,kind);if(generation!==turn.current)return;
      const images=[...value[kind]];images[Math.min(index,images.length)]=image;onChange({...value,[kind]:images});
    } catch(cause){if(generation===turn.current)setError(cause instanceof Error?cause.message:"사진을 처리하지 못했어.");}
    finally{if(generation===turn.current)changeBusy(false);}
  }
  async function generateProfile() {
    if(busy || disabled)return;const generation=++turn.current;changeBusy(true);setGenerating(true);setError("");
    const abort=new AbortController();controller.current=abort;
    try {
      const response=await fetch(`${api}/profile`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,prompt,reference_images:value}),signal:abort.signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"프로필을 만들지 못했어.");
      if(generation===turn.current)onProfile(result.avatar_url);
    } catch(cause){if(!abort.signal.aborted && generation===turn.current)setError(cause instanceof Error?cause.message:"프로필을 만들지 못했어.");}
    finally{if(generation===turn.current){changeBusy(false);setGenerating(false);controller.current=null;}}
  }
  return <section className={styles.referenceSection} aria-label="인물 기준 사진">
    <h3>인물 기준 사진</h3>
    <p>얼굴 사진은 얼굴과 머리 특징을, 전신 사진은 체형과 신체 비율을 결정해. 원본 구도를 자르지 않고 저장해.</p>
    <div className={styles.referenceGroups}>
      {(["face","body"] as const).map(kind=><div key={kind}>
        <h4>{kind==="face"?"얼굴":"전신"} 사진 <span>{value[kind].length}/2</span></h4>
        <div className={styles.referenceSlots}>{[0,1].map(index=><div key={index} className={styles.referenceSlot}>
          <label className={kind==="body"?styles.bodyReference:styles.faceReference}>
            {value[kind][index]?<img src={value[kind][index]} alt={`${kind==="face"?"얼굴":"전신"} 기준 사진 ${index+1}`}/>:<span>＋<br/>{kind==="face"?"얼굴":"전신"} {index+1}</span>}
            <input type="file" accept="image/*" aria-label={`${kind==="face"?"얼굴":"전신"} 사진 ${index+1} 선택`} disabled={disabled||busy}
              onChange={e=>{void pick(kind,index,e.target.files?.[0]);e.target.value="";}}/>
          </label>
          {value[kind][index] && <button type="button" className={styles.modeButton} disabled={disabled||busy}
            onClick={()=>onChange({...value,[kind]:value[kind].filter((_,i)=>i!==index)})} aria-label={`${kind==="face"?"얼굴":"전신"} 사진 ${index+1} 삭제`}>삭제</button>}
        </div>)}</div>
      </div>)}
    </div>
    <p>얼굴은 정면·다른 각도, 전신은 머리부터 발끝까지 보이는 사진이 좋아. 같은 인물의 사진을 넣어 줘.</p>
    <button type="button" className={styles.generateProfile} disabled={disabled||busy||!value.face.length||!value.body.length} onClick={()=>void generateProfile()}>
      {generating?"기준 사진으로 프로필을 만들고 있어…":"기준 사진으로 프로필 생성"}
    </button>
    <p>얼굴과 전신을 각각 1장 이상 넣으면 프로필을 만들 수 있어. 생성 후 ‘저장’을 누르면 기준 사진과 프로필이 함께 적용돼.</p>
    <p>대화 중 사진 요청에도 이 원본 기준 사진을 계속 사용해.</p>
    {error && <p role="alert" className={styles.photoError}>{error}</p>}
  </section>;
}

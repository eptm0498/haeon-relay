'use client';
import {Camera,Download,RefreshCcw,Pencil} from 'lucide-react';
import type {SceneImage} from '@/lib/rp/types';
export function SceneCard({image,onRegenerate,onRevise,onOpen,onSave}:{image:SceneImage;onRegenerate:()=>void;onRevise:()=>void;onOpen:()=>void;onSave:()=>void}){
 return <article className="scene-image-card"><button className="scene-open" onClick={onOpen} aria-label="이미지 크게 보기">{image.url?/* eslint-disable-next-line @next/next/no-img-element */<img src={image.url} alt="대화 장면"/>:<span>이미지를 불러오는 중…</span>}</button><div className="scene-image-foot"><span><Camera size={14}/> 현재 장면 {image.softened&&<small>이미지 모델 제한으로 장면을 일부 완화해서 생성했어.</small>}</span><div><button onClick={onRegenerate}><RefreshCcw size={14}/> 다시 생성</button><button onClick={onRevise}><Pencil size={14}/> 장면 수정</button><button onClick={onSave}><Download size={14}/> 저장</button></div></div></article>;
}

"use client";
import {useEffect,useRef,type RefObject} from 'react';

export function useBackSwipe(surface:RefObject<HTMLElement|null>,onBack:()=>boolean|void,enabled:boolean) {
 const latestBack=useRef(onBack);
 useEffect(()=>{latestBack.current=onBack;},[onBack]);
 useEffect(()=>{
  const element=surface.current;if(!enabled||!element)return;
  let start:{x:number;y:number}|null=null;let navigating=false;
  const cancel=()=>{start=null;};
  const pop=()=>{cancel();navigating=false;};
  const touchStart=(event:TouchEvent)=>{
   cancel();const touch=event.touches[0];
   if(navigating||event.touches.length!==1||!touch||touch.clientX>36||!event.cancelable)return;
   if(event.target instanceof Element&&event.target.closest('button,a,input,textarea,select,[contenteditable="true"]'))return;
   // Own this gesture from its beginning. React's passive touch handler could
   // not cancel Safari's native history swipe, so both used to navigate back.
   event.preventDefault();
   if(event.defaultPrevented)start={x:touch.clientX,y:touch.clientY};
  };
  const touchMove=(event:TouchEvent)=>{
   const touch=event.touches[0];
   if(event.touches.length!==1||!touch||start&&Math.abs(touch.clientY-start.y)>=55)cancel();
  };
  const touchEnd=(event:TouchEvent)=>{
   const origin=start;cancel();const touch=event.changedTouches[0];
   if(navigating||!origin||!touch||touch.clientX-origin.x<=95||Math.abs(touch.clientY-origin.y)>=55)return;
   if(window.history.state?.characterLive==='chat'){navigating=true;if(latestBack.current()===false)navigating=false;}
  };
  element.addEventListener('touchstart',touchStart,{passive:false});
  element.addEventListener('touchmove',touchMove,{passive:true});
  element.addEventListener('touchend',touchEnd,{passive:true});
  element.addEventListener('touchcancel',cancel,{passive:true});
  window.addEventListener('popstate',pop);
  return()=>{
   element.removeEventListener('touchstart',touchStart);element.removeEventListener('touchmove',touchMove);
   element.removeEventListener('touchend',touchEnd);element.removeEventListener('touchcancel',cancel);
   window.removeEventListener('popstate',pop);
  };
 },[surface,enabled]);
}

"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
type State={characters:Record<string,{enabled:boolean;seenAt:number}>;subscribed:boolean;publicKey:string};
const empty:State={characters:{},subscribed:false,publicKey:''};
export function useCompanion(enabled:boolean,activeId:string,view:string,busy:boolean,onMessage:()=>void,latestMessageAt=0) {
 const [state,setState]=useState<State>(empty);const [error,setError]=useState('');const [registering,setRegistering]=useState(false);const device=useRef('');
 const refreshMessage=useRef(onMessage);refreshMessage.current=onMessage;
 const heartbeatBusy=useRef(false);
 const call=useCallback(async(action:string,characterId?:string,data?:object)=>{
  if(!device.current){device.current=localStorage.getItem('character-live-device')||crypto.randomUUID();localStorage.setItem('character-live-device',device.current);}
  const response=await fetch('/api/dokyeong/companion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,deviceId:device.current,characterId,data}),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'선톡 설정을 저장하지 못했어.');setState(result);return result as State;
 },[]);
 useEffect(()=>{
  if(!enabled)return;
  const heartbeat=()=>{if(heartbeatBusy.current)return;heartbeatBusy.current=true;void call('presence',view==='chat'?activeId:undefined,{visible:!document.hidden,busy}).catch(()=>{}).finally(()=>{heartbeatBusy.current=false;});};
  heartbeat();const timer=window.setInterval(heartbeat,30000);
  document.addEventListener('visibilitychange',heartbeat);window.addEventListener('focus',heartbeat);
  const message=(event:MessageEvent)=>{if(event.data?.type==='CHARACTER_MESSAGE')refreshMessage.current();};
  navigator.serviceWorker?.addEventListener('message',message);
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',heartbeat);window.removeEventListener('focus',heartbeat);navigator.serviceWorker?.removeEventListener('message',message);};
 },[enabled,activeId,view,busy,call,latestMessageAt]);
 async function toggle(){setError('');try{await call('preference',activeId,{enabled:state.characters[activeId]?.enabled===false});}catch(e){setError((e as Error).message);}}
 async function notifications(){
  setError('');
  if(!('Notification' in window)||!('PushManager' in window)){setError('아이폰은 Safari에서 홈 화면에 추가한 뒤 앱을 열고 알림을 허용해 줘.');return;}
  if(!state.publicKey){setError('알림 설정을 불러오는 중이야. 잠시 후 눌러줘.');return;}
  setRegistering(true);
  try{
   const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('알림을 받으려면 기기에서 알림을 허용해 줘.');
   const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('알림 준비가 지연되고 있어. 앱을 다시 열어 줘.')),10000))]);
   const encoded=state.publicKey.replace(/-/g,'+').replace(/_/g,'/');const bytes=Uint8Array.from(atob(encoded),(c)=>c.charCodeAt(0));
   const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
   await call('subscribe',undefined,subscription.toJSON());
  }catch(e){setError((e as Error).message||'알림 등록이 중단됐어.');}finally{setRegistering(false);}
 }
 async function stopNotifications(){setError('');try{await call('unsubscribe');const r=await navigator.serviceWorker.ready;await (await r.pushManager.getSubscription())?.unsubscribe();}catch(e){setError((e as Error).message);}}
 async function testNotification(){
  if(!state.subscribed)throw Error('먼저 이 기기에서 알림 받기를 켜 줘.');
  const response=await fetch('/api/dokyeong/companion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',deviceId:device.current,characterId:activeId})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'테스트 알림을 보내지 못했어.');
 }
 return {state,error,registering,toggle,notifications,stopNotifications,testNotification};
}

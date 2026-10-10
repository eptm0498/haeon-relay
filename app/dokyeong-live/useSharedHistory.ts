"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatImage = { dataUrl: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; name?: string };
export type Message = { id?: string; role: "user" | "assistant"; content: string; ts?: number; image?: ChatImage; proactive?:boolean };
type History = { character_id:string; epoch:string; messages:Message[]; import_allowed:boolean };
type Outbox = { epoch:string; messages:Message[] };
const historyKey = (id:string) => "character-live-history-v2:" + id;
const outboxKey = (id:string) => "character-live-outbox-v1:" + id;
const migratedKey = (id:string) => "character-live-migrated-v1:" + id;

function merge(a:Message[], b:Message[]) {
  const items = new Map<string,Message>();
  for (const message of [...a,...b]) if (message.id) items.set(message.id,message);
  return [...items.values()].sort((x,y) => (x.ts || 0)-(y.ts || 0) || String(x.id).localeCompare(String(y.id))).slice(-1000);
}
function removeLocal(key:string) { try {localStorage.removeItem(key);} catch {} }
function writeLocal(key:string,value:string) { try {localStorage.setItem(key,value);} catch {} }
function readLocal(key:string) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function legacyMessages(value:unknown):Message[] {
  if (!Array.isArray(value)) return [];
  return value.filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string").slice(-40).map((m,index) => {
    const ts = Number.isSafeInteger(m.ts) ? m.ts : index;
    let hash = 2166136261;
    for (const ch of m.role + ":" + m.content) hash = Math.imul(hash ^ ch.charCodeAt(0),16777619) >>> 0;
    return {id:m.id || `legacy:${ts}:${hash}`,role:m.role,content:m.content,ts};
  });
}
async function request(body?:object, etag="") {
  const response = await fetch("/api/dokyeong/history", body ? {
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    signal:AbortSignal.timeout(90000),
  } : {cache:"no-store",headers:etag?{"If-None-Match":etag}:{},signal:AbortSignal.timeout(90000)});
  if(response.status===304)return {rows:null,etag};
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "대화 동기화에 실패했어."),{status:response.status});
  return body ? result : {rows:result,etag:response.headers.get("etag")||""};
}

export function useSharedHistory(characters:{id:string;is_default:boolean}[], enabled:boolean,refreshInterval=5000) {
  const [histories,setHistories] = useState<Record<string,Message[]>>({});
  const [ready,setReady] = useState(false);
  const [error,setError] = useState("");
  const states = useRef<Record<string,History>>({});
  const outboxes = useRef<Record<string,Outbox>>({});
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  const task = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const lastEtag = useRef("");
  const publish = useCallback(() => {
    const next:Record<string,Message[]> = {};
    for (const [id,state] of Object.entries(states.current)) {
      const pending = outboxes.current[id];
      next[id] = merge(state.messages,pending?.epoch === state.epoch ? pending.messages : []);
      // Local cache keeps text; the server also preserves newly sent photos.
      try { localStorage.setItem(historyKey(id),JSON.stringify(next[id].map(({image,...message}) => ({...message,content:message.content || (image ? "[사진]" : "")})))); } catch {}
    }
    setHistories(next);
  },[]);

  const flush = useCallback(async () => {
    for (const [id,pending] of Object.entries(outboxes.current)) {
      while (pending.messages.length) {
        const batch:Message[] = [];
        let bytes = 0;
        for (const message of pending.messages.slice(0,40)) {
          const size = JSON.stringify(message).length;
          if (batch.length && bytes+size > 2800000) break;
          bytes += size; batch.push(message);
        }
        try {
          const saved:History = await request({action:"append",characterId:id,epoch:pending.epoch,messages:batch});
          lastEtag.current="";
          states.current[id] = {...saved,messages:states.current[id]?.epoch===saved.epoch?merge(states.current[id].messages,saved.messages):saved.messages};
          const sent = new Set(batch.map(m => m.id));
          pending.messages = pending.messages.filter(m => !sent.has(m.id));
          if (!pending.messages.length) { delete outboxes.current[id]; removeLocal(outboxKey(id)); }
          else writeLocal(outboxKey(id),JSON.stringify(pending));
        } catch (cause) {
          if ((cause as {status?:number}).status === 409) {
            delete outboxes.current[id]; removeLocal(outboxKey(id));
            break;
          }
          throw cause;
        }
      }
    }
  },[]);

  const synchronize = useCallback(() => {
    if (busy.current) return task.current;
    busy.current = true;
    task.current = task.current.catch(()=>{}).then(async () => {
      try {
        await flush();
        const result=await request(undefined,lastEtag.current);
        const rows:History[] = result.rows;
        lastEtag.current=result.etag;
        for (let state of rows||[]) {
          const character = charactersRef.current.find(c => c.id===state.character_id);
          if (!character) continue;
          const id=state.character_id;
          const pending:Outbox | null = outboxes.current[id] || readLocal(outboxKey(id));
          if (pending?.epoch===state.epoch && Array.isArray(pending.messages)) outboxes.current[id]=pending;
          else if (pending) { delete outboxes.current[id]; removeLocal(outboxKey(id)); }
          if (!readLocal(migratedKey(id))) {
            const old = readLocal(historyKey(id)) || (character.is_default ? readLocal("dokyeong-live-history-v1") : null);
            const legacy = legacyMessages(old);
            if (state.import_allowed && legacy.length) {state=await request({action:"import",characterId:id,epoch:state.epoch,messages:legacy});lastEtag.current="";}
            writeLocal(migratedKey(id),"1");
          }
          states.current[id]={...state,messages:states.current[id]?.epoch===state.epoch?merge(states.current[id].messages,state.messages):state.messages};
        }
        await flush();
        publish(); setReady(true); setError("");
      } catch (cause) { lastEtag.current="";setError(cause instanceof Error && !['TimeoutError','TypeError'].includes(cause.name) ? cause.message : "연결을 다시 확인하고 있어. 보내지 못한 메시지는 연결되면 자동으로 저장할게.");throw cause; }
      finally { busy.current=false; }
    });
    return task.current;
  },[flush,publish]);

  const ids = characters.map(c => c.id).join(",");
  useEffect(() => {
    if (!enabled || !ids) return;
    void synchronize().catch(()=>{});
    const refresh=()=> {if (!document.hidden) void synchronize().catch(()=>{});};
    window.addEventListener("focus",refresh);
    window.addEventListener("online",refresh);
    document.addEventListener("visibilitychange",refresh);
    const timer=window.setInterval(refresh,refreshInterval);
    return ()=> {window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh);window.clearInterval(timer);};
  },[enabled,ids,synchronize,refreshInterval]);

  function append(id:string,messages:Message[]) {
    const state=states.current[id];
    if (!state || !messages.length) return;
    const pending=outboxes.current[id] || {epoch:state.epoch,messages:[]};
    pending.messages=merge(pending.messages,messages);
    outboxes.current[id]=pending;
    try {writeLocal(outboxKey(id),JSON.stringify(pending));} catch {setError("이 기기의 임시 저장 공간이 부족해. 연결이 유지되는지 확인해 줘.");}
    publish();
    void synchronize().catch(()=>{});
  }
  async function reset(id:string,keepMemory=false) {
    await synchronize();
    await task.current;
    busy.current = true;
    task.current = task.current.then(async () => {
      try {
        const state=states.current[id];
        if (!state) throw new Error("대화를 먼저 불러와 줘.");
        const saved:History=await request({action:"reset",characterId:id,epoch:state.epoch,messages:[],keepMemory});
        lastEtag.current="";
        states.current[id]=saved; delete outboxes.current[id];
        removeLocal(outboxKey(id)); writeLocal(migratedKey(id),"1");
        publish();
      } finally { busy.current = false; }
    });
    await task.current;
  }

  function addOlder(id:string,messages:Message[]) {
    const state=states.current[id];if(!state)return;
    state.messages=merge(messages,state.messages);publish();
  }
  return {histories,ready,error,append,reset,synchronize,addOlder};
}

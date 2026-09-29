export type Character={id:string;name:string;description:string;gender:string;age:string;appearance:string;body:string;hair:string;personality:string;speech:string;world:string;secrets:string;opening:string;scenario:string;created_at:string};
export type Persona={id:string;name:string;description:string};
export type Session={id:string;character_id:string;persona_id:string|null;title:string;summary:string;model:string;thinking:string;length:string;last_summarized_message_id:string|null;created_at:string;updated_at:string};
export type Message={id:string;session_id:string;role:'user'|'model';content:string;is_ooc:boolean;ordinal:number;created_at:string;input_tokens:number;output_tokens:number;thinking_tokens:number;cost_usd:number;model:string};
export type Reference={id:string;character_id:string;path:string;label:string;url?:string};
export type SceneImage={id:string;session_id:string;anchor_message_id:string|null;anchor_ordinal:number;path:string;model:string;softened:boolean;created_at:string;url?:string};
export type Memory={id:string;session_id:string;content:string;created_at:string};
export type Usage={id:string;session_id:string;character_id:string;model:string;input_tokens:number;output_tokens:number;thinking_tokens:number;cost_usd:number;created_at:string};
export const RP_MODEL='gemini-3.1-pro-preview';
export const SCENE_MODEL='gemini-3.1-flash-lite';
export const IMAGE_MODEL='gemini-3.1-flash-image';
export function cost(model:string,input:number,output:number){const p=model===SCENE_MODEL?[.25,1.5]:model==='gemini-2.5-flash'?[.3,2.5]:model==='gemini-2.5-pro'?[1.25,10]:[2,12];return (input*p[0]+output*p[1])/1e6}
export const money=(n:number)=>'$'+n.toFixed(n<.01?4:2);
export const won=(usd:number,rate:number|null)=>rate?new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:usd*rate<10?1:0}).format(usd*rate):'환율 확인 중…';

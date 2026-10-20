export type StoryChapter = {id:string;title:string;facts:string;terms:string[];sourceIds:string[]};
export type StoryExample = {cue:string;reply:string;spoken:string;sourceId:string};
export type StoryExcerpt = {seq:number;sourceId:string;text:string};
export type StorySettings = {
  instructions:string;
  current_state:string;
  style_guide:string;
  chat_prompt:string;
  voice_prompt:string;
  chapters:StoryChapter[];
  examples:StoryExample[];
  memory_excerpts:StoryExcerpt[];
};
export type EditorStory = StorySettings & {
  source_title:string;source_url:string;captured_at:string;message_count:number;
};
export type StorySource = {instructions:string;total:number;offset:number;messages:{id:string;role:string;content:string;seq:number}[]};

// Reconstruct editable fields explicitly. Original transcripts and source metadata
// never become writable through a client-supplied object.
export function parseStorySettings(value:unknown):StorySettings|null {
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const v=value as Record<string,unknown>;
  const str=(s:unknown,max:number):s is string=>typeof s==="string"&&s.length<=max;
  const strings=(s:unknown,max:number):s is string[]=>Array.isArray(s)&&s.length<=100&&s.every(x=>str(x,max));
  if (!["instructions","current_state","style_guide","chat_prompt","voice_prompt"].every(k=>str(v[k],60000)) ||
      !Array.isArray(v.chapters)||v.chapters.length>100 || !Array.isArray(v.examples)||v.examples.length>1000 ||
      !Array.isArray(v.memory_excerpts)||v.memory_excerpts.length>1500) return null;
  if (!v.chapters.every(c=>c&&str(c.id,100)&&str(c.title,200)&&str(c.facts,20000)&&strings(c.terms,100)&&strings(c.sourceIds,200)) ||
      new Set(v.chapters.map(c=>c.id)).size!==v.chapters.length ||
      !v.examples.every(e=>e&&str(e.cue,2000)&&str(e.reply,10000)&&str(e.spoken,10000)&&str(e.sourceId,200)) ||
      !v.memory_excerpts.every(e=>e&&Number.isSafeInteger(e.seq)&&e.seq>=0&&e.seq<=1000000&&str(e.sourceId,200)&&str(e.text,15000))) return null;
  const result:StorySettings={
    instructions:v.instructions as string,current_state:v.current_state as string,style_guide:v.style_guide as string,
    chat_prompt:v.chat_prompt as string,voice_prompt:v.voice_prompt as string,
    chapters:v.chapters.map(c=>({id:c.id,title:c.title,facts:c.facts,terms:c.terms,sourceIds:c.sourceIds})),
    examples:v.examples.map(e=>({cue:e.cue,reply:e.reply,spoken:e.spoken,sourceId:e.sourceId})),
    memory_excerpts:v.memory_excerpts.map(e=>({seq:e.seq,sourceId:e.sourceId,text:e.text})),
  };
  return JSON.stringify(result).length<=1800000 ? result : null;
}

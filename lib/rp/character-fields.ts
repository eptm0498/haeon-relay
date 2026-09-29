import type {Character} from './types';

const join=(...parts:string[])=>parts.map(p=>p?.trim()).filter(Boolean).join('\n');

// Older characters used separate profile and opening fields. Fold them into the new editor.
export function characterFields(c:Character){
 return {
  name:c.name,age:c.age,
  appearance:join(c.appearance,c.body&&`체형: ${c.body}`,c.hair&&`헤어스타일: ${c.hair}`),
  personality:join(c.personality,c.description&&`소개: ${c.description}`,c.speech&&`말투: ${c.speech}`),
  world:c.world,secrets:c.secrets,
  opening:join(c.scenario&&`*${c.scenario.replace(/^\*|\*$/g,'').trim()}*`,c.opening),
 };
}

export function characterPayload(fields:ReturnType<typeof characterFields>){
 return {...fields,gender:'남성',description:'',body:'',hair:'',speech:'',scenario:''};
}

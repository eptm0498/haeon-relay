import {serverRpc,updateMemory} from './memory';
import {readLiveCharacter,readCharacterReferences} from './characters';
import {generateCharacterPhoto,ImageGenerationError} from './image-generation';
import {memoryContext} from './memory';
import {deliverPushJobs} from './push';
import {currentTimeContext} from './time-context';
import {geminiJson} from './gemini-json';
import {photoScenePrompt,photoSceneSchema,parsePhotoScene,type PhotoScene} from './image-scene';
export type ImageJob={id:string;character_id:string;epoch:string;status:'queued'|'running'|'complete'|'failed';attempts:number;error:string;message_id?:string;payload:{text:string;scene:string;context?:string;sourceMessageId?:string};lease:string};
export async function runImageJob(id?:string){
 const job=await serverRpc<ImageJob|null>('live_image_work',{action:'claim',target_job:id||null});if(!job)return false;
 try{
  const character=await readLiveCharacter(job.character_id);if(!character)throw new Error('캐릭터를 찾지 못했어.');
  const references=await readCharacterReferences(character.id);
  const source=job.payload.sourceMessageId?await serverRpc<{dataUrl:string}|null>('live_data_work',{action:'media',target_character:character.id,data:{messageId:job.payload.sourceMessageId}}):null;
  const request=job.payload.text||job.payload.scene;
  const planned=parsePhotoScene(await geminiJson<PhotoScene>(photoScenePrompt({name:character.name,characterPrompt:character.prompt,request,proposedScene:job.payload.scene,context:currentTimeContext()+(job.payload.context||''),memory:await memoryContext(character.id),editing:!!source}),photoSceneSchema));
  const generated=await generateCharacterPhoto({name:character.name,characterPrompt:planned.appearance,references,avatar:character.avatar_url,request,scene:planned.scene,sourceImage:source?.dataUrl,signal:AbortSignal.timeout(190000)});
  await serverRpc('live_image_work',{action:'complete',target_job:job.id,data:{lease:job.lease,image:generated.image}});
  console.log('LIVE_IMAGE_JOB_OK',job.id,generated.model,generated.referenceCount);
  await Promise.all([updateMemory(character.id,1).catch(()=>{}),deliverPushJobs().catch(()=>0)]);return true;
 }catch(error){
  await serverRpc('live_image_work',{action:'fail',target_job:job.id,data:{lease:job.lease,error:error instanceof ImageGenerationError?error.message:'사진 생성이 중단됐어. 같은 요청으로 다시 시도할 수 있어.'}});
  console.warn('LIVE_IMAGE_JOB_FAILED',job.id);return false;
 }
}

export type VoiceFailure={code:string;message:string;terminal:boolean};
// Never forward provider response bodies, account details, or credentials to the UI/logs.
export function voiceFailure(value:unknown,status=502):VoiceFailure {
 const data=value as {detail?:{status?:string};code?:string;error?:{code?:string}|string;message?:string}|null;
 const code=data?.detail?.status||data?.code||(typeof data?.error==='object'?data.error?.code:'')||'';
 const hint=(code+' '+(typeof data?.error==='string'?data.error:'')+' '+(data?.message||'')).toLowerCase();
 if(/payment_issue|payment_required/.test(hint))return {code:'payment_issue',message:'ElevenLabs 결제 문제로 캐릭터 목소리를 사용할 수 없어.',terminal:true};
 if(/quota_exceeded|insufficient_credits|insufficient_quota/.test(hint))return {code:'quota_exceeded',message:'ElevenLabs 음성 크레딧을 모두 사용했어.',terminal:true};
 if(status===401||/invalid_api_key|authentication/.test(hint))return {code:'authentication_error',message:'ElevenLabs 연결 인증을 확인해야 해.',terminal:true};
 if(status===403)return {code:'permission_denied',message:'이 목소리를 사용할 권한을 확인해야 해.',terminal:true};
 return {code:code||'voice_unavailable',message:'목소리 생성이 일시적으로 끊겼어. 다시 시도해 줘.',terminal:false};
}
export function backupVoiceNotice(code:string){
 return `${voiceFailure({code}).message} 임시 OpenAI 음성으로 대화 중이야.`;
}

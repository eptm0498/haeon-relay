export async function readJsonResponse<T>(response:Response):Promise<T>{
 const body=await response.text();
 if(!body.trim())throw new Error('이미지 서버가 빈 응답을 보냈어. 잠시 후 다시 시도해 줘.');
 try{return JSON.parse(body) as T}
 catch{throw new Error('이미지 서버 응답을 읽지 못했어. 잠시 후 다시 시도해 줘.')}
}

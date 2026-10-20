import { NextRequest } from "next/server";
import { noStore } from "@/lib/dokyeong/auth";
import { rpc, verifyEditor } from "@/lib/dokyeong/settings";
import type { EditorStory, StorySource } from "@/lib/dokyeong/story-settings";
import { projectMediumPrompt } from "@/lib/dokyeong/project-dialogue";

export const runtime="nodejs";
type Context={params:Promise<{token:string}>};

export async function GET(request:NextRequest,{params}:Context) {
  const {token}=await params;
  try {
    if (!await verifyEditor(token)) return Response.json({error:"편집 링크를 확인해 줘."},{status:404,headers:noStore});
    const id=request.nextUrl.searchParams.get("characterId")||"";
    if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({error:"캐릭터를 확인해 줘."},{status:400,headers:noStore});
    if (request.nextUrl.searchParams.has("offset")) {
      const offset=Number(request.nextUrl.searchParams.get("offset"));
      if (!Number.isSafeInteger(offset)||offset<0) return Response.json({error:"원문 위치를 확인해 줘."},{status:400,headers:noStore});
      return Response.json(await rpc<StorySource>("live_editor_story_source",{edit_token:token,target_character:id,page_offset:offset},15000),{headers:noStore});
    }
    const story=await rpc<EditorStory|null>("live_editor_story",{edit_token:token,target_character:id},20000);
    return Response.json(story ? {...story,chat_prompt:story.chat_prompt??projectMediumPrompt(),voice_prompt:story.voice_prompt??projectMediumPrompt(true)} : null,{headers:noStore});
  } catch {
    return Response.json({error:"전체 기억을 불러오지 못했어. 잠시 후 다시 시도해 줘."},{status:503,headers:noStore});
  }
}

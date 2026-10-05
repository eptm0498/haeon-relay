import { rpc } from "./settings";
import { emptyReferences, type ReferenceImages } from "./reference-images";

export type LiveCharacter = {
  id: string;
  name: string;
  prompt: string;
  voice_id: string;
  voice_name: string;
  avatar_url: string | null;
  reference_images?: ReferenceImages;
  is_default: boolean;
  sort_order: number;
  version: number;
  created_at?: string;
  updated_at: string;
};

export type PublicCharacter = Pick<LiveCharacter, "id"|"name"|"voice_id"|"voice_name"|"avatar_url"|"is_default"|"sort_order">;

export function listCharacters(editToken: string) {
  return rpc<LiveCharacter[]>("live_list_characters", { edit_token: editToken }, 10000);
}

export function listCharacterSummaries(editToken:string) {
  return rpc<LiveCharacter[]>("live_character_summaries",{edit_token:editToken},10000);
}

export function readEditorReferences(editToken:string,characterId:string) {
  return rpc<ReferenceImages>("live_editor_character_references",{edit_token:editToken,character_id:characterId},15000);
}

export function listPublicCharacters() {
  return rpc<PublicCharacter[]>("live_public_characters", {}, 8000);
}

export async function readLiveCharacter(characterId?: string | null) {
  const rows = await rpc<LiveCharacter[]>("live_read_character", { character_id: characterId || null }, 8000);
  return rows[0] || null;
}

export function saveLiveCharacter(editToken: string, character: Partial<LiveCharacter>) {
  return rpc<LiveCharacter>("live_save_character_with_references", {
    edit_token: editToken,
    character_id: character.id || null,
    character_name: character.name,
    new_prompt: character.prompt,
    new_voice_id: character.voice_id,
    new_voice_name: character.voice_name || "",
    new_avatar_url: character.avatar_url || "",
    make_default: !!character.is_default,
    new_sort_order: Number.isInteger(character.sort_order) ? character.sort_order : 0,
    expected_version: character.id ? character.version ?? null : null,
    new_reference_images: character.reference_images || emptyReferences(),
  }, 10000);
}

export function readCharacterReferences(characterId: string) {
  const token=process.env.CHARACTER_HISTORY_KEY;
  if (!token) throw new Error("reference images not configured");
  return rpc<ReferenceImages>("live_read_character_references",{server_token:token,target_character:characterId},15000);
}

export function deleteLiveCharacter(editToken: string, characterId: string) {
  return rpc<boolean>("live_delete_character", { edit_token: editToken, character_id: characterId }, 10000);
}

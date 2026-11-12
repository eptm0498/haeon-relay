import { rpc } from "./settings";
import type { CallPhoto } from "./call-scenes";

export function readCallPhotos(characterId: string) {
  if (!process.env.CHARACTER_HISTORY_KEY) return Promise.resolve([]);
  return rpc<CallPhoto[]>("live_call_photos_read", {
    server_token: process.env.CHARACTER_HISTORY_KEY, target_character: characterId,
  }, 8000, AbortSignal.timeout(1800));
}

export function readCallPhoto(characterId: string, photoId: string) {
  return rpc<string | null>("live_call_photos_read", {
    server_token: process.env.CHARACTER_HISTORY_KEY, target_character: characterId, target_photo: photoId,
  }, 8000);
}

export function editorCallPhotos<T>(token: string, characterId: string, action: string, photoId?: string, situation?: string, image?: string) {
  return rpc<T>("live_call_photos_edit", {
    edit_token: token, target_character: characterId, action, target_photo: photoId,
    new_situation: situation, new_image: image,
  }, 10000);
}

export function callPhotoResponse(image: string | null) {
  if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(Buffer.from(image, "base64")), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

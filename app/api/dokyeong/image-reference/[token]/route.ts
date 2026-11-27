import { verifyImageReference } from "@/lib/dokyeong/image-reference";
import { readCharacterReferences, readLiveCharacter } from "@/lib/dokyeong/characters";
import { serverRpc } from "@/lib/dokyeong/memory";
import sharp from "sharp";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const grant = verifyImageReference(token);
  if (!grant) return new Response(null, { status: 404, headers });
  try {
    if (grant.kind === "board") {
      const references = await readCharacterReferences(grant.characterId);
      const views = [...references.face.map(dataUrl => ({ dataUrl, label: "MASTER FACE" })), ...references.body.map(dataUrl => ({ dataUrl, label: "MASTER BODY" }))];
      if (!views.length) { const avatar = (await readLiveCharacter(grant.characterId))?.avatar_url; if (avatar) views.push({ dataUrl: avatar, label: "IDENTITY" }); }
      if (grant.messageId) { const source = await serverRpc<{ dataUrl: string } | null>("live_data_work", { action: "media", target_character: grant.characterId, data: { messageId: grant.messageId } }); if (!source) throw Error(); views.push({ dataUrl: source.dataUrl, label: "PREVIOUS SCENE" }); }
      if (!views.length || views.length > 5) throw Error();
      const tiles = [];
      for (let index = 0; index < views.length; index++) {
        const { dataUrl, label } = views[index];
        const match = dataUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match || dataUrl.length > 2000000) throw Error();
        const picture = await sharp(Buffer.from(match[1], "base64"), { limitInputPixels: 16000000 }).resize(512,600,{fit:"contain",background:"#ffffff"}).toBuffer();
        const caption = Buffer.from(`<svg width="512" height="40"><rect width="512" height="40" fill="white"/><text x="15" y="27" font-size="22" font-family="sans-serif" fill="black">${label}</text></svg>`);
        const tile = await sharp({create:{width:512,height:640,channels:3,background:"white"}}).composite([{input:picture,top:40,left:0},{input:caption,top:0,left:0}]).jpeg({quality:90}).toBuffer();
        tiles.push({input:tile,top:Math.floor(index/2)*640,left:(index%2)*512});
      }
      const board = await sharp({create:{width:1024,height:Math.ceil(views.length/2)*640,channels:3,background:"white"}}).composite(tiles).jpeg({quality:90}).toBuffer();
      return new Response(new Uint8Array(board), { headers: { ...headers, "Content-Type": "image/jpeg" } });
    }
    let dataUrl: string | undefined | null;
    if (grant.kind === "source") dataUrl = (await serverRpc<{ dataUrl: string } | null>("live_data_work", { action: "media", target_character: grant.characterId, data: { messageId: grant.messageId } }))?.dataUrl;
    else if (grant.kind === "avatar") dataUrl = (await readLiveCharacter(grant.characterId))?.avatar_url;
    else dataUrl = (await readCharacterReferences(grant.characterId))[grant.kind][grant.index];
    const match = dataUrl?.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || dataUrl!.length > 2000000) return new Response(null, { status: 404, headers });
    const bytes = await sharp(Buffer.from(match[1], "base64"), { limitInputPixels: 40000000 }).jpeg({ quality: 90 }).toBuffer();
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch { return new Response(null, { status: 404, headers }); }
}

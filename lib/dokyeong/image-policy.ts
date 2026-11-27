export class ImagePolicyError extends Error {}
export async function checkPhotoContent(text: string, images: string[], signal: AbortSignal) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Error("Image check unavailable");
  const input = [
    ...(text ? [{ type: "text", text }] : []),
    ...images.map(url => ({ type: "image_url", image_url: { url } })),
  ];
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input }), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw Error("Image check unavailable");
  const data = await response.json();
  if (!Array.isArray(data.results) || !data.results.length || data.results.some((r: { flagged?: boolean }) => typeof r.flagged !== "boolean")) throw Error("Image check unavailable");
  if (data.results.some((r: { flagged: boolean }) => r.flagged)) throw new ImagePolicyError("Image request rejected");
}

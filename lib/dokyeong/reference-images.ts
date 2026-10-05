export type ReferenceImages = { face: string[]; body: string[] };
export const emptyReferences = (): ReferenceImages => ({face:[],body:[]});

export function parseReferences(value: unknown): ReferenceImages | null {
  if (!value || typeof value !== "object") return null;
  const refs = value as Partial<ReferenceImages>;
  const valid = (items: unknown): items is string[] => Array.isArray(items) && items.length <= 2 &&
    items.every(item => typeof item === "string" && item.length <= 600000 && item.length >= 40 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(item));
  return valid(refs.face) && valid(refs.body) ? {face:refs.face,body:refs.body} : null;
}

export function identityReferences(refs: ReferenceImages, avatar?: string | null) {
  const result = [...refs.face.map(url => ({url,kind:"face"})),...refs.body.map(url => ({url,kind:"body"}))];
  // Master references always win over a generated/cropped profile.
  if (!result.length && avatar) result.push({url:avatar,kind:"profile"});
  return result;
}

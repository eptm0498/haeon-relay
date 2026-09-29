// Asterisks mark scene narration. Keep at most its first sentence; plain text is dialogue.
export function formatRoleplay(raw:string){
 const narrations=[...raw.matchAll(/\*([^*]+)\*/g)];
 if(!narrations.length)return raw.trim();
 const first=narrations[0][1].trim().replace(/\s+/g,' ');
 const sentence=first.match(/^.*?[.!?。！？](?=\s|$)/u)?.[0]||first;
 const dialogue=raw.replace(/\*[^*]+\*/g,'').trim();
 return [`*${sentence.trim()}*`,dialogue].filter(Boolean).join('\n');
}

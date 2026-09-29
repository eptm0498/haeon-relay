export function RoleplayText({content,model=false}:{content:string;model?:boolean}){
 if(!model)return <p>{content}</p>;
 const parts=[...content.matchAll(/\*([^*]+)\*/g)];
 if(!parts.length)return <p>{content}</p>;
 const narration=parts[0][1].trim();
 const dialogue=content.replace(/\*[^*]+\*/g,'').trim();
 return <div className="roleplay-text"><p className="roleplay-narration">{narration}</p>{dialogue&&<p className="roleplay-dialogue">{dialogue}</p>}</div>;
}

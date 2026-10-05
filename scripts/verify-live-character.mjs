import { createHmac } from "node:crypto";
await import("./verify-chat-images.mjs");
await import("./verify-reference-model.mjs");

// Opt-in operational checks: no credential, transcript, or audio is logged.
// An ordinary deployment makes no paid API calls.
const requested = process.env.VERCEL_GIT_COMMIT_MESSAGE?.match(/\[verify-live:([^\]]+)\]/)?.[1];
if (!requested) process.exit(0);
const origin = "https://haeon-relay.vercel.app";
const secret = process.env.DOKYEONG_ACCESS_CODE?.trim();
if (!secret || !process.env.ELEVENLABS_API_KEY) throw new Error("Live verification credentials unavailable");
const expiry = String(Date.now() + 120000);
const signature = createHmac("sha256", secret).update(expiry).digest("hex");
const headers = { Origin: origin, Cookie: `dokyeong_live_session=${expiry}.${signature}`, "Content-Type": "application/json" };
const call = (path, options={}) => fetch(origin + path, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(60000) });
const voicesResponse = await call("/api/dokyeong/voices");
if (!voicesResponse.ok) throw new Error("Live voice listing failed: " + voicesResponse.status);
const voices = await voicesResponse.json();
const voice = voices.voices?.find(v => v.name.trim() === requested.trim());
if (!voice || voices.source !== "live") throw new Error("Exact live ElevenLabs voice unavailable: " + requested);
console.log("LIVE_VERIFY_VOICE " + JSON.stringify({name:voice.name, voice_id:voice.voice_id}));
const charsResponse = await call("/api/dokyeong/characters");
if (!charsResponse.ok) throw new Error("Character listing failed: " + charsResponse.status);
const chars = await charsResponse.json();
const items = Array.isArray(chars) ? chars : chars.characters;
const character = items?.find(c => c.name === requested);
if (!character) { console.log("LIVE_VERIFY_DISCOVERY_COMPLETE"); process.exit(0); }
if (character.voice_id !== voice.voice_id) throw new Error("Stored voice does not match ElevenLabs");
const answerResponse = await call("/api/dokyeong/respond", {method:"POST",body:JSON.stringify({characterId:character.id,messages:[{role:"user",content:"온유야, 오늘은 돈 안 쓰고 그냥 편하게 이야기하고 싶어."}],voice:false})});
if (!answerResponse.ok) throw new Error("Character response failed: " + answerResponse.status);
const events = await answerResponse.text();
if (events.includes('"type":"error"') || !events.includes('"type":"done"') || !events.includes('"type":"delta"')) throw new Error("Character response stream incomplete");
console.log("LIVE_VERIFY_RESPONSE_OK " + character.id);
const tts = await call("/api/dokyeong/tts", {method:"POST",body:JSON.stringify({characterId:character.id,text:"현우야, 그냥 편하게 이야기하자."})});
if (!tts.ok || !tts.headers.get("Content-Type")?.startsWith("audio/")) throw new Error("Character TTS failed: " + tts.status);
const audio = await tts.arrayBuffer();
if (audio.byteLength < 1000) throw new Error("Character audio empty");
console.log("LIVE_VERIFY_AUDIO_OK " + JSON.stringify({bytes:audio.byteLength,model:tts.headers.get("X-Dokyeong-TTS-Model")}));

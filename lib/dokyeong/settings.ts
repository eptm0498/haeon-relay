import { dokyeongPrompt } from "./character";
import { rpcTransport } from "./rpc-transport";

const endpoint = "https://ckesuyinmcqemgeemzlh.supabase.co/rest/v1/rpc/";
// Supabase's public anon key. The editor capability is checked inside Postgres.
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrZXN1eWlubWNxZW1nZWVtemxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzQ4MzYsImV4cCI6MjA5NzcxMDgzNn0.TxYiy3xWoqMHrsWzntcr6CFA-nyRKhUgomkhCbFQi-Y";

type CharacterRow = { prompt: string; version: number; updated_at: string };

export async function rpc<T>(name: string, body: object, timeout = 5000): Promise<T> {
  return rpcTransport<T>(endpoint, anonKey, name, body, timeout);
}

export async function readCharacter() {
  const row = await rpc<CharacterRow|null>("live_server_character", {server_token:process.env.CHARACTER_HISTORY_KEY,character_id:null});
  return row || { prompt: dokyeongPrompt, version: null, updated_at: null };
}

export async function activeCharacterPrompt() {
  try { return (await readCharacter()).prompt; }
  catch { return dokyeongPrompt; }
}

export async function verifyEditor(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return rpc<boolean>("dokyeong_verify_editor", { edit_token: token });
}

export async function saveCharacter(token: string, prompt: string, version: number | null) {
  return rpc<CharacterRow[]>("dokyeong_save_character", {
    edit_token: token, new_prompt: prompt, expected_version: version,
  });
}

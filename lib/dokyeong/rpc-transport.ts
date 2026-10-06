// Only retry reads and writes with explicit, stable idempotency keys.
export function retryAllowed(name: string, body: object) {
  const action = (body as {action?: string}).action;
  if (name.startsWith('live_server_') || ['live_character_summaries','live_list_characters','live_read_character_references','live_editor_character_references'].includes(name)) return true;
  if (name === 'live_sync_history') return ['read','append','import'].includes(action || 'read');
  if (name === 'live_data_work') return ['versions','settings','archive','search','memory'].includes(action || '');
  if (name === 'live_companion_work') return ['status','presence'].includes(action || '');
  if (name === 'live_reply_work') return action === 'enqueue';
  return false; // Never blindly retry leases, resets, paid generations or unknown mutations.
}

export async function rpcTransport<T>(endpoint: string, key: string, name: string, body: object, timeout: number): Promise<T> {
  const started = Date.now();
  const attempts = retryAllowed(name, body) ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(endpoint + name, {
        method: 'POST',
        headers: {apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json'},
        body: JSON.stringify(body), cache:'no-store',
        signal: AbortSignal.timeout(Math.max(10000, timeout)),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const cause = Object.assign(new Error(['40001','PT409'].includes(error.code) ? 'VERSION_CONFLICT' : error.message === 'IMAGE_DAILY_LIMIT' ? 'IMAGE_DAILY_LIMIT' : `Settings request failed: ${response.status}`), {status:response.status, code:typeof error.code === 'string' ? error.code : undefined});
        throw cause;
      }
      return await response.json() as T;
    } catch (cause) {
      const error = cause as {name?:string;status?:number;code?:string};
      const transient = error.name === 'TimeoutError' || error.name === 'TypeError' || [429,502,503,504].includes(error.status || 0);
      if (transient && attempt + 1 < attempts) {
        await new Promise(resolve => setTimeout(resolve, 350));
        continue;
      }
      // Never log capability tokens, prompts, messages, or raw SQL error details.
      console.error('LIVE_DB_REQUEST_FAILED', {rpc:name, action:(body as {action?:string}).action, status:error.status, code:error.code, reason:error.name, elapsedMs:Date.now()-started, attempts:attempt+1});
      throw cause;
    }
  }
  throw new Error('Database request unavailable');
}

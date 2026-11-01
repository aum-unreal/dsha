// Minimal streaming client for DeepSeek's OpenAI-format chat API.
// Docs: https://api-docs.deepseek.com/ (thinking mode: reasoning_content must be
// sent back on every assistant turn whenever `tools` is present).

export const DEFAULT_BASE = 'https://api.deepseek.com';
// A stream that sends nothing for this long (no tokens, no keep-alive) counts as a dropped connection.
const IDLE_MS = Number(process.env.DSH_IDLE_MS) || 120_000;

// USD per 1M tokens, [peak, off-peak]. Pricing page as of 2026-11-01.
export const PRICES = {
  'deepseek-flash': { hit: [0.006, 0.003], miss: [0.3, 0.15], out: [1.2, 0.6] },
  'deepseek-v4-pro': { hit: [0.044, 0.022], miss: [1.32, 0.66], out: [3.96, 1.98] },
};

export function cost(model, u) {
  const p = PRICES[model] || PRICES['deepseek-flash'];
  const f = i => ((u.hit || 0) * p.hit[i] + (u.miss || 0) * p.miss[i] + (u.out || 0) * p.out[i]) / 1e6;
  return { peak: f(0), offpeak: f(1) };
}

export class DeepSeek {
  constructor({ key, base = DEFAULT_BASE, fetchImpl = fetch }) {
    this.key = key; this.base = base.replace(/\/$/, ''); this.fetch = fetchImpl;
  }

  async get(path) {
    const r = await this.fetch(this.base + path, { headers: { authorization: 'Bearer ' + this.key } }).catch(e => { throw asApiError(e); });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return r.json();
  }

  models() { return this.get('/models'); }
  balance() { return this.get('/user/balance'); }

  // Streams one completion. Calls on.reasoning(delta), on.text(delta) as they
  // arrive; resolves to the assembled assistant message plus usage.
  async stream({ model, messages, tools, effort, thinking = true, maxTokens }, on = {}, signal) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true } };
    if (tools?.length) body.tools = tools;
    body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    if (thinking && effort) body.reasoning_effort = effort;
    if (maxTokens) body.max_tokens = maxTokens;
    // Our own controller, so a silent connection can be cut without stopping the run.
    const ctl = new AbortController(), stop = () => ctl.abort();
    signal?.addEventListener('abort', stop, { once: true });
    let idle = 0; const touch = () => { clearTimeout(idle); idle = setTimeout(() => { ctl.idle = true; ctl.abort(); }, IDLE_MS); };
    const asErr = e => ctl.idle ? new ApiError(0, `no answer for ${Math.round(IDLE_MS / 1000)} s`, 'network') : asApiError(e);
    touch();
    try {
    const r = await this.fetch(this.base + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    }).catch(e => { throw asErr(e); });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    const msg = { role: 'assistant', content: '', reasoning_content: '' };
    const calls = [];
    let usage = null, finish = null, buf = '';
    const dec = new TextDecoder();
    try { for await (const chunk of r.body) {
      touch();
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.usage) usage = j.usage;
        const c = j.choices?.[0]; if (!c) continue;
        if (c.finish_reason) finish = c.finish_reason;
        const d = c.delta || {};
        if (d.reasoning_content) { msg.reasoning_content += d.reasoning_content; on.reasoning?.(d.reasoning_content); }
        if (d.content) { msg.content += d.content; on.text?.(d.content); }
        for (const t of d.tool_calls || []) {
          const cur = calls[t.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (t.id) cur.id = t.id;
          if (t.function?.name) cur.function.name += t.function.name;
          if (t.function?.arguments) cur.function.arguments += t.function.arguments;
          on.toolDelta?.(t.index, cur);
        }
      }
    } } catch (e) { throw asErr(e); }
    if (calls.length) msg.tool_calls = calls.filter(Boolean);
    return { message: msg, finish, usage: normUsage(usage) };
    } finally { clearTimeout(idle); signal?.removeEventListener('abort', stop); }
  }
}

export function normUsage(u) {
  if (!u) return { hit: 0, miss: 0, out: 0 };
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens || 0) - hit);
  return { hit, miss, out: u.completion_tokens || 0, reasoning: u.completion_tokens_details?.reasoning_tokens || 0 };
}

// kind: auth (401/403), balance (402), rate (429), busy (5xx), network (no answer at all), bad (anything else).
// rate, busy and network are worth retrying; the others need the user.
export class ApiError extends Error {
  constructor(status, body, kind) {
    let m = body; try { m = JSON.parse(body).error?.message || body; } catch {}
    super(status ? `DeepSeek API ${status}: ${String(m).slice(0, 500)}` : `Can't reach DeepSeek: ${String(m).slice(0, 500)}`);
    this.status = status;
    this.kind = kind || (status === 401 || status === 403 ? 'auth' : status === 402 ? 'balance' : status === 429 ? 'rate' : status >= 500 ? 'busy' : 'bad');
  }
  get transient() { return ['rate', 'busy', 'network'].includes(this.kind); }
}

// fetch() rejects with a bare TypeError ("fetch failed") on DNS, TLS or connection errors; name it.
export function asApiError(e) {
  if (e instanceof ApiError || e?.name === 'AbortError') return e;
  const c = e?.cause, why = c?.code || c?.message || e?.message || String(e);
  return new ApiError(0, why, 'network');
}

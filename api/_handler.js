// Framework-agnostic LLM proxy. Holds the provider config; the client never
// sees or chooses a model. Which model runs is decided entirely by env:
//   AI_PROVIDER   — 'deepseek-flash' (default) | 'openai-mini'
//   DEEPSEEK_API_KEY / OPENAI_API_KEY — the upstream keys (server-side only)
//
// Both providers speak the OpenAI chat-completions format.
import process from 'node:process';

const PROVIDERS = {
  'deepseek-flash': {
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    keyEnv: 'DEEPSEEK_API_KEY',
    // deepseek-v4-flash is a hybrid model that DEFAULTS to Thinking Mode — it
    // spends most of the token budget on hidden chain-of-thought before the
    // answer, adding heavy latency (and emitting empty content if the budget
    // runs out mid-thought). Move selection is a simple task and the prompt now
    // hands the model every number it needs (dmg/spm/line/throwbackDmg), so we
    // DISABLE thinking for instant, cheap answers. Top-level field per DeepSeek
    // docs: https://api-docs.deepseek.com/guides/thinking_mode
    extraBody: { thinking: { type: 'disabled' } },
  },
  'openai-mini': {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4.1-mini',
    keyEnv: 'OPENAI_API_KEY',
    // No extraBody — OpenAI rejects unknown body params with a 400.
  },
};

const DEFAULT_PROVIDER = 'deepseek-flash';

/**
 * Run one chat completion. Input is ONLY { system, messages, maxTokens } —
 * the client cannot influence which model runs.
 *
 * @returns {Promise<{ text: string }>}
 * @throws  {Error} when the env key is missing or the upstream call fails,
 *          so the client falls back to random moves.
 */
export async function handleAi(body, env = process.env) {
  // Default high: a reasoning model (e.g. deepseek-v4-flash) spends most of the
  // budget on chain-of-thought before the answer, so a low cap returns empty
  // content (finish_reason "length"). The client sends its own maxTokens too.
  const { system, messages = [], maxTokens = 2048 } = body || {};

  const providerKey = env.AI_PROVIDER || DEFAULT_PROVIDER;
  const provider = PROVIDERS[providerKey] || PROVIDERS[DEFAULT_PROVIDER];
  const apiKey = env[provider.keyEnv];

  if (!apiKey) {
    const err = new Error(`Missing ${provider.keyEnv} — no managed key configured`);
    err.status = 503;
    throw err;
  }

  // FUTURE: credit check + decrement here (per-user metering) before forwarding.
console.log("***** api calling*****")
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      ...provider.extraBody,   // e.g. DeepSeek's { thinking: { type: 'disabled' } }
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => {console.log("error")});
    const err = new Error(`Upstream ${providerKey} HTTP ${res.status}: ${detail.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
console.log(JSON.stringify(data));
    
  const text = data.choices?.[0]?.message?.content ?? '';
    console.log("***** api calling end*****", text)
  return { text };
}

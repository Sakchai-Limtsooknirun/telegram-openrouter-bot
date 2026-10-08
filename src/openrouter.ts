import type { Env } from "./telegram";

const BASE = "https://openrouter.ai/api/v1";

export interface KeyInfo {
  limit: number | null;
  usage: number;
  limit_remaining: number | null;
  is_free_tier: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function getKeyInfo(env: Env): Promise<KeyInfo> {
  const res = await fetch(`${BASE}/key`, {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /key failed: ${res.status}`);
  const body = (await res.json()) as { data: KeyInfo };
  return body.data;
}

export async function listModels(env: Env): Promise<ModelInfo[]> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error(`OpenRouter /models failed: ${res.status}`);
  const body = (await res.json()) as { data: ModelInfo[] };
  return body.data;
}

function isFree(m: ModelInfo): boolean {
  return m.pricing?.prompt === "0" && m.pricing?.completion === "0";
}

export function searchModels(models: ModelInfo[], q: string): ModelInfo[] {
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? models.filter(
        (m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
      )
    : models;
  return hits
    .slice()
    .sort((a, b) => {
      const fa = isFree(a) ? 0 : 1;
      const fb = isFree(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 8);
}

export async function streamChat(
  env: Env,
  opts: { model: string; messages: ChatMessage[]; max_tokens: number },
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.max_tokens,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter chat failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.body;
}

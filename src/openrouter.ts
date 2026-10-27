import type { Env } from "./telegram";
import { DEFAULT_PROVIDER_ID, getProvider, providerKey } from "./providers";

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

export type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
    >;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatContent;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ServerTool {
  type: "openrouter:web_search";
  parameters: {
    engine: "exa";
    mode: "auto";
    max_uses: number;
    max_results: number;
    search_context_size?: "low" | "medium" | "high";
  };
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  tools?: Array<ToolDefinition | ServerTool>;
  stream?: boolean;
  providerId?: string;
}

export async function getKeyInfo(env: Env, providerId?: string): Promise<KeyInfo> {
  const provider = getProvider(providerId ?? DEFAULT_PROVIDER_ID);
  if (provider.id !== DEFAULT_PROVIDER_ID) {
    throw new Error("Quota is only available on OpenRouter.");
  }
  const res = await fetch(`${provider.baseUrl}/key`, {
    headers: { Authorization: `Bearer ${providerKey(env, provider)}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /key failed: ${res.status}`);
  const body = (await res.json()) as { data: KeyInfo };
  return body.data;
}

export async function listModels(env: Env, providerId?: string): Promise<ModelInfo[]> {
  const provider = getProvider(providerId ?? DEFAULT_PROVIDER_ID);
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${providerKey(env, provider)}` },
  });
  if (!res.ok) throw new Error(`${provider.label} /models failed: ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
  if (!Array.isArray(body.data)) {
    throw new Error(`${provider.label} /models returned an unexpected body.`);
  }
  return body.data
    .filter((model): model is { id: string; name?: string } => typeof model.id === "string")
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      // Non-OpenRouter /models responses carry no context length or pricing.
      // Marking them paid keeps the free-first ordering in searchModels stable.
      context_length: 0,
      pricing: { prompt: "1", completion: "1" },
    }));
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
  opts: ChatCompletionOptions,
): Promise<ReadableStream<Uint8Array>> {
  const provider = getProvider(opts.providerId ?? DEFAULT_PROVIDER_ID);
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerKey(env, provider)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.max_tokens,
      ...(opts.tools ? { tools: opts.tools } : {}),
      stream: opts.stream ?? true,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${provider.label} chat failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.body;
}

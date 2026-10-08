import type { Env } from "./telegram";
import type { ModelInfo } from "./openrouter";

const CACHE_TTL_MS = 60 * 60 * 1000;

interface ModelCache {
  at: number;
  models: ModelInfo[];
}

export async function getSelectedModel(env: Env, chatId: number): Promise<string> {
  const v = await env.BOT_KV.get(`model:${chatId}`);
  return v ?? env.DEFAULT_MODEL;
}

export async function setSelectedModel(env: Env, chatId: number, modelId: string): Promise<void> {
  await env.BOT_KV.put(`model:${chatId}`, modelId);
}

export async function getModelCache(env: Env): Promise<ModelInfo[] | null> {
  const raw = await env.BOT_KV.get("models:cache");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ModelCache;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

export async function setModelCache(env: Env, models: ModelInfo[]): Promise<void> {
  const payload: ModelCache = { at: Date.now(), models };
  await env.BOT_KV.put("models:cache", JSON.stringify(payload));
}

export async function getPendingSearch(env: Env, chatId: number): Promise<boolean> {
  return (await env.BOT_KV.get(`search:${chatId}`)) === "1";
}

export async function setPendingSearch(env: Env, chatId: number, on: boolean): Promise<void> {
  if (on) {
    await env.BOT_KV.put(`search:${chatId}`, "1");
  } else {
    await env.BOT_KV.delete(`search:${chatId}`);
  }
}

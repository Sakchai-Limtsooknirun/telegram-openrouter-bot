import type { Env } from "./telegram";

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  keyEnv: string;
  defaultModel: string;
}

export const DEFAULT_PROVIDER_ID = "openrouter";

export const PROVIDERS: Provider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    // Resolved from env.DEFAULT_MODEL at runtime.
    defaultModel: "",
  },
  {
    id: "9arm",
    label: "9arm",
    baseUrl: "https://api.tokenme.limited/api/v1",
    keyEnv: "PROVIDER_9ARM_KEY",
    defaultModel: "deepseek-ai/deepseek-v4-flash-0731",
  },
];

export function getProvider(id: string): Provider {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

export function providerDefaultModel(env: Env, provider: Provider): string {
  return provider.id === DEFAULT_PROVIDER_ID ? env.DEFAULT_MODEL : provider.defaultModel;
}

function envValue(env: Env, name: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[name];
}

export function hasProviderKey(env: Env, provider: Provider): boolean {
  return Boolean(envValue(env, provider.keyEnv));
}

export function providerKey(env: Env, provider: Provider): string {
  const key = envValue(env, provider.keyEnv);
  if (!key) throw new Error(`Missing API key: set the ${provider.keyEnv} secret.`);
  return key;
}

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
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "PROVIDER_OPENAI_KEY",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "PROVIDER_GROQ_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: "PROVIDER_DEEPSEEK_KEY",
    defaultModel: "deepseek-chat",
  },
  {
    id: "together",
    label: "Together",
    baseUrl: "https://api.together.xyz/v1",
    keyEnv: "PROVIDER_TOGETHER_KEY",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyEnv: "PROVIDER_MISTRAL_KEY",
    defaultModel: "mistral-small-latest",
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

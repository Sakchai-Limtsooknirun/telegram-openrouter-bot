import type { ChatMessage, ToolCall, ToolDefinition } from "./openrouter";
import { getKeyInfo, listModels, searchModels } from "./openrouter";
import {
  completeTask,
  createNote,
  createReminder,
  createTask,
  deleteNote,
  deleteReminder,
  deleteTask,
  listNotes,
  listReminders,
  listTasks,
  searchNotes,
  updateTask,
} from "./state";
import type { Env } from "./telegram";

const PAGE_BYTES_LIMIT = 48 * 1024;
const PAGE_TIMEOUT_MS = 5000;
const PAGE_REDIRECT_LIMIT = 3;
const CALCULATOR_LIMIT = 200;

interface ToolContext {
  env: Env;
  chatId: number;
}

type ToolHandler = (context: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${key}" must be a non-empty string.`);
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`"${key}" must be a string.`);
  return value;
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`"${key}" must be a finite number.`);
  return value;
}

function parseArguments(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

class ArithmeticParser {
  private index = 0;

  constructor(private readonly source: string) {
    if (!source.trim() || source.length > CALCULATOR_LIMIT) throw new Error("Expression is empty or too long.");
    if (!/^[\d\s.+\-*/^()%]+$/.test(source)) throw new Error("Calculator accepts arithmetic only.");
  }

  parse(): number {
    const value = this.expression();
    this.space();
    if (this.index !== this.source.length) throw new Error("Unexpected input in expression.");
    if (!Number.isFinite(value)) throw new Error("Calculation is not finite.");
    return value;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      this.space();
      const op = this.source[this.index];
      if (op !== "+" && op !== "-") return value;
      this.index++;
      const right = this.term();
      value = op === "+" ? value + right : value - right;
    }
  }

  private term(): number {
    let value = this.power();
    for (;;) {
      this.space();
      const op = this.source[this.index];
      if (op !== "*" && op !== "/" && op !== "%") return value;
      this.index++;
      const right = this.power();
      if ((op === "/" || op === "%") && right === 0) throw new Error("Division by zero.");
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
  }

  private power(): number {
    let value = this.unary();
    this.space();
    if (this.source[this.index] === "^") {
      this.index++;
      value **= this.power();
    }
    return value;
  }

  private unary(): number {
    this.space();
    if (this.source[this.index] === "+") {
      this.index++;
      return this.unary();
    }
    if (this.source[this.index] === "-") {
      this.index++;
      return -this.unary();
    }
    if (this.source[this.index] === "(") {
      this.index++;
      const value = this.expression();
      this.space();
      if (this.source[this.index] !== ")") throw new Error("Missing closing parenthesis.");
      this.index++;
      return value;
    }
    const match = this.source.slice(this.index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) throw new Error("Expected a number.");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private space(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index++;
  }
}

const LENGTH_UNITS: Record<string, number> = {
  m: 1,
  meter: 1,
  meters: 1,
  km: 1000,
  cm: 0.01,
  mm: 0.001,
  mi: 1609.344,
  mile: 1609.344,
  miles: 1609.344,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
};
const MASS_UNITS: Record<string, number> = {
  kg: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  gram: 0.001,
  grams: 0.001,
  lb: 0.45359237,
  lbs: 0.45359237,
  pound: 0.45359237,
  pounds: 0.45359237,
  oz: 0.028349523125,
  ounce: 0.028349523125,
  ounces: 0.028349523125,
};

function convertUnits(value: number, from: string, to: string): number {
  const source = from.toLowerCase();
  const target = to.toLowerCase();
  if (source === target) return value;
  if (source === "c" || source === "celsius" || source === "f" || source === "fahrenheit") {
    const celsius = source === "c" || source === "celsius" ? value : (value - 32) * (5 / 9);
    if (target === "c" || target === "celsius") return celsius;
    if (target === "f" || target === "fahrenheit") return celsius * (9 / 5) + 32;
  }
  for (const units of [LENGTH_UNITS, MASS_UNITS]) {
    if (units[source] !== undefined && units[target] !== undefined) return (value * units[source]) / units[target];
  }
  throw new Error(`Unsupported conversion from "${from}" to "${to}".`);
}

function isPublicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host.endsWith(".lan") ||
    host.endsWith(".corp") ||
    host.endsWith(".test") ||
    host.endsWith(".example") ||
    host.endsWith(".invalid") ||
    host.endsWith(".onion") ||
    host.endsWith(".arpa") ||
    host.includes(":")
  ) {
    throw new Error("Only public HTTPS URLs are allowed.");
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (
      ipv4.slice(1).some((part) => Number(part) > 255) ||
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    ) {
      throw new Error("Private or reserved IP addresses are not allowed.");
    }
  }
  return url;
}

async function readPage(urlText: string): Promise<{ url: string; text: string }> {
  let url = isPublicHttpsUrl(urlText);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    let response: Response | undefined;
    for (let redirects = 0; redirects <= PAGE_REDIRECT_LIMIT; redirects++) {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,text/plain,application/xhtml+xml" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects === PAGE_REDIRECT_LIMIT) throw new Error("Page redirect limit exceeded.");
      url = isPublicHttpsUrl(new URL(location, url).toString());
    }
    if (!response?.ok) throw new Error(`Page request failed: ${response?.status ?? "no response"}`);
    const type = response.headers.get("content-type") ?? "";
    if (!/^(text\/html|text\/plain|application\/xhtml\+xml)\b/i.test(type)) {
      throw new Error("Page must be HTML or plain text.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Page response has no body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PAGE_BYTES_LIMIT) {
        await reader.cancel();
        throw new Error("Page is larger than the 48 KB limit.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const source = new TextDecoder().decode(bytes);
    const text = type.includes("html")
      ? source.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;|&#160;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;|&apos;/gi, "'")
      : source;
    return { url: url.toString(), text: text.replace(/\s+/g, " ").trim().slice(0, 12000) };
  } finally {
    clearTimeout(timeout);
  }
}

const parameter = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const stringField = { type: "string" };

const toolHandlers: Record<string, ToolHandler> = {
  calculator: async (_context, args) => ({ result: new ArithmeticParser(requiredString(args, "expression")).parse() }),
  convert_units: async (_context, args) => ({
    result: convertUnits(requiredNumber(args, "value"), requiredString(args, "from"), requiredString(args, "to")),
  }),
  openrouter_quota: async ({ env }) => getKeyInfo(env),
  search_models: async ({ env }, args) => {
    const models = await listModels(env);
    return searchModels(models, optionalString(args, "query") ?? "").map((model) => ({
      id: model.id, name: model.name, context_length: model.context_length, pricing: model.pricing,
    }));
  },
  openrouter_status: async () => {
    const response = await fetch("https://status.openrouter.ai/api/v2/status.json");
    if (!response.ok) throw new Error(`OpenRouter status request failed: ${response.status}`);
    return await response.json();
  },
  read_webpage: async (_context, args) => readPage(requiredString(args, "url")),
  create_task: async ({ env, chatId }, args) => createTask(env, chatId, requiredString(args, "text")),
  list_tasks: async ({ env, chatId }) => listTasks(env, chatId),
  update_task: async ({ env, chatId }, args) =>
    updateTask(env, chatId, requiredString(args, "id"), requiredString(args, "text")),
  complete_task: async ({ env, chatId }, args) => ({
    completed: await completeTask(env, chatId, requiredString(args, "id")),
  }),
  delete_task: async ({ env, chatId }, args) => ({
    deleted: await deleteTask(env, chatId, requiredString(args, "id")),
  }),
  create_note: async ({ env, chatId }, args) => createNote(env, chatId, requiredString(args, "text")),
  list_notes: async ({ env, chatId }) => listNotes(env, chatId),
  search_notes: async ({ env, chatId }, args) => searchNotes(env, chatId, requiredString(args, "query")),
  delete_note: async ({ env, chatId }, args) => ({
    deleted: await deleteNote(env, chatId, requiredString(args, "id")),
  }),
  create_reminder: async ({ env, chatId }, args) =>
    createReminder(env, chatId, requiredString(args, "text"), requiredString(args, "date")),
  list_reminders: async ({ env, chatId }) => listReminders(env, chatId),
  delete_reminder: async ({ env, chatId }, args) => ({
    deleted: await deleteReminder(env, chatId, requiredString(args, "id")),
  }),
};

const specs: Array<[string, string, Record<string, unknown>, string[]]> = [
  ["calculator", "Evaluate a basic arithmetic expression.", parameter({ expression: stringField }, ["expression"]), ["expression"]],
  ["convert_units", "Convert a length, mass, or temperature value.", parameter({
    value: { type: "number" }, from: stringField, to: stringField,
  }, ["value", "from", "to"]), ["value", "from", "to"]],
  ["openrouter_quota", "Read this bot key's current OpenRouter quota.", parameter({}), []],
  ["search_models", "Search OpenRouter models by name or id.", parameter({ query: stringField }), []],
  ["openrouter_status", "Read public OpenRouter service status.", parameter({}), []],
  ["read_webpage", "Read a small public HTTPS webpage.", parameter({ url: stringField }, ["url"]), ["url"]],
  ["create_task", "Create a task in this Telegram chat.", parameter({ text: stringField }, ["text"]), ["text"]],
  ["list_tasks", "List tasks for this Telegram chat.", parameter({}), []],
  ["update_task", "Update a task by id.", parameter({ id: stringField, text: stringField }, ["id", "text"]), ["id", "text"]],
  ["complete_task", "Mark a task complete by id.", parameter({ id: stringField }, ["id"]), ["id"]],
  ["delete_task", "Delete a task by id.", parameter({ id: stringField }, ["id"]), ["id"]],
  ["create_note", "Save a note in this Telegram chat.", parameter({ text: stringField }, ["text"]), ["text"]],
  ["list_notes", "List notes for this Telegram chat.", parameter({}), []],
  ["search_notes", "Search notes in this Telegram chat.", parameter({ query: stringField }, ["query"]), ["query"]],
  ["delete_note", "Delete a note by id.", parameter({ id: stringField }, ["id"]), ["id"]],
  ["create_reminder", "Create a one-time date-based reminder in this Telegram chat.", parameter({
    text: stringField, date: { type: "string", description: "YYYY-MM-DD in Asia/Bangkok" },
  }, ["text", "date"]), ["text", "date"]],
  ["list_reminders", "List reminders for this Telegram chat.", parameter({}), []],
  ["delete_reminder", "Delete a reminder by id.", parameter({ id: stringField }, ["id"]), ["id"]],
];

export const LOCAL_TOOLS: ToolDefinition[] = specs.map(([name, description, parameters]) => ({
  type: "function",
  function: { name, description, parameters },
}));

const toolSchemas = new Map(specs.map(([name, , schema]) => [name, schema]));

export const WEB_SEARCH_TOOL = {
  type: "openrouter:web_search",
  parameters: {
    engine: "exa",
    mode: "auto",
    max_uses: 1,
    max_results: 3,
    search_context_size: "low",
  },
} as const;

export async function executeToolCall(
  context: ToolContext,
  call: ToolCall,
): Promise<ChatMessage> {
  let content: string;
  try {
    const handler = toolHandlers[call.function.name];
    if (!handler) throw new Error(`Unsupported tool: ${call.function.name}`);
    const args = parseArguments(call.function.arguments);
    const schema = toolSchemas.get(call.function.name);
    const properties = schema?.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw new Error(`No argument schema for tool: ${call.function.name}`);
    }
    const allowed = new Set(Object.keys(properties));
    for (const key of Object.keys(args)) {
      if (!allowed.has(key)) throw new Error(`Unsupported argument "${key}" for ${call.function.name}.`);
    }
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !Object.hasOwn(args, key)) {
          throw new Error(`Missing required argument "${key}".`);
        }
      }
    }
    content = JSON.stringify(await handler(context, args));
  } catch (error) {
    content = JSON.stringify({ error: String(error instanceof Error ? error.message : error) });
  }
  return { role: "tool", tool_call_id: call.id, content };
}

export function isLocalTool(name: string): boolean {
  return Object.hasOwn(toolHandlers, name);
}

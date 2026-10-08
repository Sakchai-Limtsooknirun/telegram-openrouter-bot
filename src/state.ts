import type { Env } from "./telegram";
import type { ChatMessage, ModelInfo } from "./openrouter";

const CACHE_TTL_MS = 60 * 60 * 1000;
const HISTORY_LIMIT = 12;
const RECORD_LIMIT = 100;
const RECORD_TEXT_LIMIT = 4000;

export interface TaskRecord {
  id: string;
  text: string;
  completed: boolean;
  created_at: string;
}

export interface NoteRecord {
  id: string;
  text: string;
  created_at: string;
}

export interface ReminderRecord {
  id: string;
  text: string;
  date: string;
  created_at: string;
}

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

export async function getHistory(env: Env, chatId: number): Promise<ChatMessage[]> {
  const raw = await env.BOT_KV.get(`hist:${chatId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export async function appendHistory(
  env: Env,
  chatId: number,
  msgs: ChatMessage[],
): Promise<void> {
  const history = await getHistory(env, chatId);
  const next = history.concat(msgs).slice(-HISTORY_LIMIT);
  await env.BOT_KV.put(`hist:${chatId}`, JSON.stringify(next));
}

export async function clearHistory(env: Env, chatId: number): Promise<void> {
  await env.BOT_KV.delete(`hist:${chatId}`);
}

function boundedText(value: string): string {
  const text = value.trim();
  if (!text || text.length > RECORD_TEXT_LIMIT) {
    throw new Error(`Text must be between 1 and ${RECORD_TEXT_LIMIT} characters.`);
  }
  return text;
}

async function readRecords<T>(env: Env, key: string): Promise<T[]> {
  const raw = await env.BOT_KV.get(key);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]).slice(0, RECORD_LIMIT) : [];
  } catch {
    return [];
  }
}

async function writeRecords<T>(env: Env, key: string, records: T[]): Promise<void> {
  await env.BOT_KV.put(key, JSON.stringify(records.slice(0, RECORD_LIMIT)));
}

function recordId(): string {
  return crypto.randomUUID();
}

export async function listTasks(env: Env, chatId: number): Promise<TaskRecord[]> {
  return readRecords<TaskRecord>(env, `tasks:${chatId}`);
}

export async function createTask(env: Env, chatId: number, text: string): Promise<TaskRecord> {
  const key = `tasks:${chatId}`;
  const tasks = await readRecords<TaskRecord>(env, key);
  if (tasks.length >= RECORD_LIMIT) throw new Error("Task limit reached (100).");
  const task: TaskRecord = {
    id: recordId(),
    text: boundedText(text),
    completed: false,
    created_at: new Date().toISOString(),
  };
  tasks.push(task);
  await writeRecords(env, key, tasks);
  return task;
}

export async function updateTask(
  env: Env,
  chatId: number,
  id: string,
  text: string,
): Promise<TaskRecord | null> {
  const key = `tasks:${chatId}`;
  const tasks = await readRecords<TaskRecord>(env, key);
  const task = tasks.find((item) => item.id === id);
  if (!task) return null;
  task.text = boundedText(text);
  await writeRecords(env, key, tasks);
  return task;
}

export async function completeTask(env: Env, chatId: number, id: string): Promise<boolean> {
  const key = `tasks:${chatId}`;
  const tasks = await readRecords<TaskRecord>(env, key);
  const task = tasks.find((item) => item.id === id);
  if (!task) return false;
  task.completed = true;
  await writeRecords(env, key, tasks);
  return true;
}

export async function deleteTask(env: Env, chatId: number, id: string): Promise<boolean> {
  const key = `tasks:${chatId}`;
  const tasks = await readRecords<TaskRecord>(env, key);
  const filtered = tasks.filter((item) => item.id !== id);
  if (filtered.length === tasks.length) return false;
  await writeRecords(env, key, filtered);
  return true;
}

export async function createNote(env: Env, chatId: number, text: string): Promise<NoteRecord> {
  const key = `notes:${chatId}`;
  const notes = await readRecords<NoteRecord>(env, key);
  if (notes.length >= RECORD_LIMIT) throw new Error("Note limit reached (100).");
  const note: NoteRecord = {
    id: recordId(),
    text: boundedText(text),
    created_at: new Date().toISOString(),
  };
  notes.push(note);
  await writeRecords(env, key, notes);
  return note;
}

export async function listNotes(env: Env, chatId: number): Promise<NoteRecord[]> {
  return readRecords<NoteRecord>(env, `notes:${chatId}`);
}

export async function searchNotes(env: Env, chatId: number, query: string): Promise<NoteRecord[]> {
  const needle = boundedText(query).toLowerCase();
  return (await listNotes(env, chatId)).filter((note) => note.text.toLowerCase().includes(needle));
}

export async function deleteNote(env: Env, chatId: number, id: string): Promise<boolean> {
  const key = `notes:${chatId}`;
  const notes = await readRecords<NoteRecord>(env, key);
  const filtered = notes.filter((item) => item.id !== id);
  if (filtered.length === notes.length) return false;
  await writeRecords(env, key, filtered);
  return true;
}

export async function createReminder(
  env: Env,
  chatId: number,
  text: string,
  date: string,
): Promise<ReminderRecord> {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Reminder date must be a valid YYYY-MM-DD date.");
  }
  const key = `reminders:${chatId}`;
  const reminders = await readRecords<ReminderRecord>(env, key);
  if (reminders.length >= RECORD_LIMIT) throw new Error("Reminder limit reached (100).");
  const reminder: ReminderRecord = {
    id: recordId(),
    text: boundedText(text),
    date,
    created_at: new Date().toISOString(),
  };
  reminders.push(reminder);
  await writeRecords(env, key, reminders);
  return reminder;
}

export async function listReminders(env: Env, chatId: number): Promise<ReminderRecord[]> {
  return readRecords<ReminderRecord>(env, `reminders:${chatId}`);
}

export async function listDueReminders(
  env: Env,
  today: string,
): Promise<Map<number, ReminderRecord[]>> {
  const grouped = new Map<number, ReminderRecord[]>();
  const prefix = "reminders:";
  let cursor: string | undefined;
  do {
    const page = await env.BOT_KV.list({ prefix, cursor });
    for (const key of page.keys) {
      const chatId = Number(key.name.slice(prefix.length));
      if (!Number.isSafeInteger(chatId)) continue;
      const due = (await readRecords<ReminderRecord>(env, key.name)).filter((item) => item.date <= today);
      if (due.length) grouped.set(chatId, due);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return grouped;
}

export async function deleteReminder(env: Env, chatId: number, id: string): Promise<boolean> {
  const key = `reminders:${chatId}`;
  const reminders = await readRecords<ReminderRecord>(env, key);
  const filtered = reminders.filter((item) => item.id !== id);
  if (filtered.length === reminders.length) return false;
  await writeRecords(env, key, filtered);
  return true;
}

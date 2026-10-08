import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  type Env,
  type InlineKeyboardMarkup,
  type TgUpdate,
} from "./telegram";
import { getKeyInfo, listModels, searchModels, type ModelInfo } from "./openrouter";
import {
  getModelCache,
  getPendingSearch,
  getSelectedModel,
  setModelCache,
  setPendingSearch,
  setSelectedModel,
} from "./state";
import { runChat } from "./index";

const HELP = [
  "<b>Commands</b>",
  "/start — show this help",
  "/help — show this help",
  "/credits — remaining OpenRouter quota for this key",
  "/model — pick a model",
  "/cancel — cancel a pending search",
  "",
  "Any other message is sent to the selected model.",
].join("\n");

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

async function loadModels(env: Env): Promise<ModelInfo[]> {
  const cached = await getModelCache(env);
  if (cached) return cached;
  const models = await listModels(env);
  await setModelCache(env, models);
  return models;
}

function modelKeyboard(models: ModelInfo[], picked: ModelInfo[]): InlineKeyboardMarkup {
  const rows = picked.map((m) => {
    const index = models.findIndex((x) => x.id === m.id);
    return [{ text: m.name || m.id, callback_data: `m:${index}` }];
  });
  rows.push([{ text: "🔍 Search", callback_data: "search" }]);
  return { inline_keyboard: rows };
}

async function showModels(env: Env, chatId: number, picked?: ModelInfo[]): Promise<void> {
  const models = await loadModels(env);
  const list = picked ?? models.slice(0, 8);
  if (list.length === 0) {
    await sendMessage(env, chatId, "No models matched.");
    return;
  }
  const current = await getSelectedModel(env, chatId);
  await sendMessage(env, chatId, `Current model: <code>${current}</code>`, modelKeyboard(models, list));
}

async function handleCredits(env: Env, chatId: number): Promise<void> {
  try {
    const info = await getKeyInfo(env);
    if (info.limit === null) {
      await sendMessage(env, chatId, `unlimited key · Used: ${usd(info.usage)}`);
      return;
    }
    const remaining = info.limit_remaining ?? info.limit - info.usage;
    await sendMessage(
      env,
      chatId,
      `Limit: ${usd(info.limit)} · Used: ${usd(info.usage)} · Remaining: ${usd(remaining)}`,
    );
  } catch (err) {
    await sendMessage(env, chatId, `Could not read quota: ${String(err)}`);
  }
}

async function handleCallback(env: Env, update: TgUpdate): Promise<void> {
  const cq = update.callback_query;
  if (!cq) return;
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  const data = cq.data ?? "";

  if (data === "search") {
    if (chatId === undefined) return;
    await setPendingSearch(env, chatId, true);
    await answerCallbackQuery(env, cq.id);
    await sendMessage(env, chatId, "Type part of a model name.");
    return;
  }

  if (data.startsWith("m:")) {
    const index = Number(data.slice(2));
    const models = await loadModels(env);
    const model = Number.isInteger(index) ? models[index] : undefined;
    if (!model) {
      await answerCallbackQuery(env, cq.id, "Model list expired, run /model again.");
      return;
    }
    if (chatId === undefined) return;
    await setSelectedModel(env, chatId, model.id);
    await answerCallbackQuery(env, cq.id, "Model set");
    if (messageId !== undefined) {
      await editMessageText(env, chatId, messageId, `Model set: <code>${model.id}</code>`);
    } else {
      await sendMessage(env, chatId, `Model set: <code>${model.id}</code>`);
    }
    return;
  }

  await answerCallbackQuery(env, cq.id);
}

export async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, update);
    return;
  }

  const message = update.message;
  const text = message?.text;
  if (!message || !text) return;
  const chatId = message.chat.id;

  if (text.startsWith("/")) {
    const command = text.split(/\s+/)[0].split("@")[0];
    switch (command) {
      case "/start":
      case "/help":
        await sendMessage(env, chatId, HELP);
        return;
      case "/credits":
        await handleCredits(env, chatId);
        return;
      case "/model":
        await showModels(env, chatId);
        return;
      case "/cancel":
        await setPendingSearch(env, chatId, false);
        await sendMessage(env, chatId, "Cancelled.");
        return;
      default:
        await sendMessage(env, chatId, `Unknown command. Try /help`);
        return;
    }
  }

  if (await getPendingSearch(env, chatId)) {
    await setPendingSearch(env, chatId, false);
    const models = await loadModels(env);
    const matches = searchModels(models, text);
    if (matches.length === 0) {
      await sendMessage(env, chatId, "No models matched.");
      return;
    }
    await sendMessage(env, chatId, `Matches for <code>${text}</code>:`, modelKeyboard(models, matches));
    return;
  }

  await runChat(env, chatId, text);
}

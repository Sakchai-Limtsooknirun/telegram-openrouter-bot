import {
  answerCallbackQuery,
  bytesToBase64,
  downloadPhoto,
  editMessageText,
  sendMessage,
  type Env,
  type InlineKeyboardMarkup,
  type TgUpdate,
} from "./telegram";
import { getKeyInfo, listModels, searchModels, type ModelInfo } from "./openrouter";
import {
  clearHistory,
  clearSelectedModel,
  getModelCache,
  getPendingSearch,
  getSelectedProviderId,
  getStoredModel,
  setModelCache,
  setPendingSearch,
  setSelectedModel,
  setSelectedProviderId,
} from "./state";
import { getProvider, hasProviderKey, providerDefaultModel, PROVIDERS } from "./providers";
import { runChat } from "./index";

const HELP = [
  "<b>Commands</b>",
  "/start — show this help",
  "/help — show this help",
  "/credits — remaining OpenRouter quota for this key",
  "/provider — switch AI provider",
  "/model — pick a model",
  "/cancel — cancel a pending search",
  "/reset — clear conversation context",
  "",
  "Ask naturally to calculate or convert units, check quota/model status, read a public webpage, or manage your tasks, notes, and date-based reminders.",
  "Current facts may use web search; source links are included. Photos are analyzed with the configured image model. Other media types are not supported.",
  "Reminders are delivered together once daily at 10:00 Asia/Bangkok.",
].join("\n");

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

async function loadModels(env: Env, providerId: string): Promise<ModelInfo[]> {
  const cached = await getModelCache(env, providerId);
  if (cached) return cached;
  const models = await listModels(env, providerId);
  await setModelCache(env, providerId, models);
  return models;
}

function modelKeyboard(
  providerId: string,
  models: ModelInfo[],
  picked: ModelInfo[],
): InlineKeyboardMarkup {
  const rows = picked.map((m) => {
    const index = models.findIndex((x) => x.id === m.id);
    return [{ text: m.name || m.id, callback_data: `mr:${providerId}:${index}` }];
  });
  rows.push([{ text: "🔍 Search", callback_data: "search" }]);
  return { inline_keyboard: rows };
}

async function showModels(env: Env, chatId: number, picked?: ModelInfo[]): Promise<void> {
  const providerId = await getSelectedProviderId(env, chatId);
  const models = await loadModels(env, providerId);
  const list = picked ?? models.slice(0, 8);
  if (list.length === 0) {
    await sendMessage(env, chatId, "No models matched.");
    return;
  }
  const stored = await getStoredModel(env, chatId);
  const current = stored ?? providerDefaultModel(env, getProvider(providerId));
  await sendMessage(
    env,
    chatId,
    `Current model: <code>${current}</code>`,
    modelKeyboard(providerId, models, list),
  );
}

function providerKeyboard(env: Env): InlineKeyboardMarkup {
  const rows = PROVIDERS.map((provider, index) => [
    {
      text: hasProviderKey(env, provider) ? provider.label : `${provider.label} (no key)`,
      callback_data: `pr:${index}`,
    },
  ]);
  return { inline_keyboard: rows };
}

async function showProviders(env: Env, chatId: number): Promise<void> {
  const current = await getSelectedProviderId(env, chatId);
  await sendMessage(
    env,
    chatId,
    `Current provider: <code>${current}</code>`,
    providerKeyboard(env),
  );
}

async function handleCredits(env: Env, chatId: number): Promise<void> {
  try {
    const providerId = await getSelectedProviderId(env, chatId);
    const info = await getKeyInfo(env, providerId);
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
    const detail = String(err);
    if (detail.includes("Quota is only available on OpenRouter")) {
      await sendMessage(
        env,
        chatId,
        "Quota is only available on OpenRouter — switch with /provider",
      );
      return;
    }
    await sendMessage(env, chatId, `Could not read quota: ${detail}`);
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

  if (data.startsWith("pr:")) {
    const index = Number(data.slice(3));
    const provider = Number.isInteger(index) ? PROVIDERS[index] : undefined;
    if (!provider) {
      await answerCallbackQuery(env, cq.id, "Provider list expired, run /provider again.");
      return;
    }
    if (chatId === undefined) return;
    await setSelectedProviderId(env, chatId, provider.id);
    await clearSelectedModel(env, chatId);
    await answerCallbackQuery(env, cq.id, "Provider set");
    if (messageId !== undefined) {
      await editMessageText(env, chatId, messageId, `Provider set: <code>${provider.label}</code>`);
    } else {
      await sendMessage(env, chatId, `Provider set: <code>${provider.label}</code>`);
    }
    return;
  }

  if (data.startsWith("mr:")) {
    if (chatId === undefined) return;
    const [providerId, rawIndex] = data.slice(3).split(":");
    const index = Number(rawIndex);
    if (!PROVIDERS.some((provider) => provider.id === providerId)) {
      await answerCallbackQuery(env, cq.id, "Model list expired, run /model again.");
      return;
    }
    const models = await loadModels(env, providerId);
    const model = Number.isInteger(index) ? models[index] : undefined;
    if (!model) {
      await answerCallbackQuery(env, cq.id, "Model list expired, run /model again.");
      return;
    }
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
  if (!message) return;
  const chatId = message.chat.id;
  const text = message.text ?? "";

  if (message.photo?.length) {
    const photo = message.photo.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (photo.file_size !== undefined && photo.file_size > 10 * 1024 * 1024) {
      await sendMessage(env, chatId, "Image is too large (maximum 10 MB).");
      return;
    }
    try {
      const bytes = await downloadPhoto(env, photo.file_id);
      await runChat(
        env,
        chatId,
        message.caption ?? "",
        `data:image/jpeg;base64,${bytesToBase64(bytes)}`,
      );
    } catch (error) {
      await sendMessage(env, chatId, `Could not process image: ${String(error)}`);
    }
    return;
  }

  if (message.document || message.video || message.audio || message.voice || message.animation || message.video_note || message.sticker) {
    await sendMessage(env, chatId, "Only Telegram photos are supported; audio, video, documents, and stickers cannot be processed.");
    return;
  }
  if (!text) return;

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
      case "/provider":
        await showProviders(env, chatId);
        return;
      case "/model":
        await showModels(env, chatId);
        return;
      case "/cancel":
        await setPendingSearch(env, chatId, false);
        await sendMessage(env, chatId, "Cancelled.");
        return;
      case "/reset":
        await clearHistory(env, chatId);
        await sendMessage(env, chatId, "Context cleared.");
        return;
      default:
        await sendMessage(env, chatId, `Unknown command. Try /help`);
        return;
    }
  }

  if (await getPendingSearch(env, chatId)) {
    await setPendingSearch(env, chatId, false);
    const providerId = await getSelectedProviderId(env, chatId);
    const models = await loadModels(env, providerId);
    const matches = searchModels(models, text);
    if (matches.length === 0) {
      await sendMessage(env, chatId, "No models matched.");
      return;
    }
    await sendMessage(
      env,
      chatId,
      `Matches for <code>${text}</code>:`,
      modelKeyboard(providerId, models, matches),
    );
    return;
  }

  await runChat(env, chatId, text);
}

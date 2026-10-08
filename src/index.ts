import { chunkHtml, editMessageText, sendMessage, type Env, type TgUpdate } from "./telegram";
import { streamChat, type ChatMessage } from "./openrouter";
import { appendHistory, getHistory, getSelectedModel } from "./state";
import { toTelegramHtml } from "./format";
import { handleUpdate } from "./commands";

const MAX_TOKENS = 1024;
const EDIT_EVERY = 12;
const SYSTEM_PROMPT = "You are a helpful assistant. Before answering, briefly plan your approach internally, then give a clear, well-structured answer. Use fenced code blocks with a language tag for any code.";

export async function runChat(env: Env, chatId: number, text: string): Promise<void> {
  const placeholder = await sendMessage(env, chatId, "⏳");
  const messageId = placeholder.result?.message_id;
  const extraIds: number[] = [];

  const flush = async (html: string): Promise<void> => {
    const chunks = chunkHtml(html);
    if (messageId !== undefined) {
      await editMessageText(env, chatId, messageId, chunks[0]);
    }
    for (let i = 1; i < chunks.length; i++) {
      const known = extraIds[i - 1];
      if (known !== undefined) {
        await editMessageText(env, chatId, known, chunks[i]);
      } else {
        const sent = await sendMessage(env, chatId, chunks[i]);
        const id = sent.result?.message_id;
        if (id !== undefined) extraIds[i - 1] = id;
      }
    }
  };

  try {
    const model = await getSelectedModel(env, chatId);
    const history = await getHistory(env, chatId);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: text },
    ];
    const body = await streamChat(env, { model, messages, max_tokens: MAX_TOKENS });

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";
    let deltas = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let delta: string | undefined;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          delta = parsed.choices?.[0]?.delta?.content;
        } catch {
          continue;
        }
        if (!delta) continue;
        acc += delta;
        deltas++;
        if (deltas % EDIT_EVERY === 0) {
          await flush(toTelegramHtml(acc));
        }
      }
    }

    await flush(toTelegramHtml(acc || "(empty response)"));
    await appendHistory(env, chatId, [
      { role: "user", content: text },
      { role: "assistant", content: acc },
    ]);
  } catch (err) {
    const message = `⚠️ ${String(err)}`;
    if (messageId !== undefined) {
      await editMessageText(env, chatId, messageId, message);
    } else {
      await sendMessage(env, chatId, message);
    }
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response("telegram-openrouter-bot: ok");
    }

    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    let update: TgUpdate;
    try {
      update = (await req.json()) as TgUpdate;
    } catch {
      return new Response("bad request", { status: 400 });
    }

    ctx.waitUntil(handleUpdate(env, update));
    return new Response("ok");
  },
};

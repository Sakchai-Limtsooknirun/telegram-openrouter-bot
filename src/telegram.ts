export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OPENROUTER_API_KEY: string;
  DEFAULT_MODEL: string;
  BOT_KV: KVNamespace;
}

export interface TgChat {
  id: number;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TgResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export async function tg<T = unknown>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<TgResponse<T>> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as TgResponse<T>;
}

export async function sendMessage(
  env: Env,
  chatId: number,
  html: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<TgResponse<TgMessage>> {
  return tg<TgMessage>(env, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

export async function editMessageText(
  env: Env,
  chatId: number,
  messageId: number,
  html: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<TgResponse<TgMessage>> {
  return tg<TgMessage>(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

export async function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string,
): Promise<TgResponse<boolean>> {
  return tg<boolean>(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

interface OpenTag {
  tag: "pre" | "code";
  open: string;
}

function popTag(stack: OpenTag[], tag: "pre" | "code"): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tag === tag) {
      stack.splice(i, 1);
      return;
    }
  }
}

function applyTag(raw: string, stack: OpenTag[]): void {
  if (raw.startsWith("<pre")) {
    stack.push({ tag: "pre", open: raw });
  } else if (raw.startsWith("<code")) {
    stack.push({ tag: "code", open: raw });
  } else if (raw.startsWith("</pre>")) {
    popTag(stack, "pre");
  } else if (raw.startsWith("</code>")) {
    popTag(stack, "code");
  }
}

interface Token {
  isTag: boolean;
  text: string;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textStart = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    const gt = html.indexOf(">", lt);
    if (gt === -1) break;
    if (lt > textStart) tokens.push({ isTag: false, text: html.slice(textStart, lt) });
    tokens.push({ isTag: true, text: html.slice(lt, gt + 1) });
    i = gt + 1;
    textStart = i;
  }
  if (textStart < html.length) tokens.push({ isTag: false, text: html.slice(textStart) });
  return tokens;
}

export function chunkHtml(html: string, limit = 4000): string[] {
  if (html.length <= limit) return [html];
  const chunks: string[] = [];
  const stack: OpenTag[] = [];
  let cur = "";
  const closeAll = () => stack
    .slice()
    .reverse()
    .map((t) => `</${t.tag}>`)
    .join("");
  const reopenAll = () => stack.map((t) => t.open).join("");
  const flush = () => {
    chunks.push(cur + closeAll());
    cur = reopenAll();
  };
  for (const tok of tokenize(html)) {
    if (tok.isTag) {
      if (cur.length > 0 && cur.length + tok.text.length + closeAll().length > limit) flush();
      cur += tok.text;
      applyTag(tok.text, stack);
      continue;
    }
    let rest = tok.text;
    while (rest.length > 0) {
      const room = limit - cur.length - closeAll().length;
      if (room <= 0) {
        flush();
        if (limit - cur.length - closeAll().length <= 0) {
          chunks.push(cur);
          cur = "";
        }
        continue;
      }
      if (rest.length <= room) {
        cur += rest;
        break;
      }
      const slice = rest.slice(0, room);
      const nl = slice.lastIndexOf("\n");
      const cut = nl > 0 ? nl + 1 : room;
      cur += rest.slice(0, cut);
      rest = rest.slice(cut);
      flush();
    }
  }
  if (cur !== "") chunks.push(cur);
  return chunks;
}

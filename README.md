# telegram-openrouter-bot

A minimal self-hosted Telegram bot that proxies your chat to OpenRouter, runs on
Cloudflare Workers (free plan), and shows your remaining per-key quota.

Features:

- `/credits` — remaining quota for your OpenRouter API key
- `/model` — pick a model from an inline keyboard, or search by partial name
- Code in replies is rendered as Telegram `<pre><code>` blocks
- Long replies are split into multiple messages automatically

---

## Conversation context

The bot remembers the last 12 messages per chat in KV under `hist:<chatId>`.
Use `/reset` to clear the conversation context. Context is per-chat and is
never shared between chats.

---

## 1. What you need

| Thing | Where to get it |
| --- | --- |
| Node.js 18 or newer | <https://nodejs.org> |
| Telegram bot token | Talk to [@BotFather](https://t.me/BotFather) in Telegram, send `/newbot`, copy the token |
| OpenRouter API key | <https://openrouter.ai/keys> |
| Free Cloudflare account | <https://dash.cloudflare.com/sign-up> — email only, no credit card |

---

## 2. Step 1 — install

```bash
npm install
```

Expected: a `node_modules/` directory is created and the command finishes with no errors.

---

## 3. Step 2 — log in to Cloudflare

```bash
npx wrangler login
```

Expected: your browser opens, you click **Allow**, and the terminal prints
`Successfully logged in`. There is no API token to copy.

---

## 4. Step 3 — create the KV namespace

```bash
npx wrangler kv namespace create BOT_KV
```

Expected output includes a line like:

```
id = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

Copy that 32-character id into `wrangler.toml`, replacing the placeholder in the
`[[kv_namespaces]]` block:

```toml
[[kv_namespaces]]
binding = "BOT_KV"
id = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

---

## 5. Step 4 — set the three secrets

Run each of these three commands. Each one prompts you to paste a value; paste it
and press Enter.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

Paste the token from @BotFather.

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Paste any random string. To generate one:

```bash
openssl rand -hex 24
```

Keep this value — you need it again in step 6.

```bash
npx wrangler secret put OPENROUTER_API_KEY
```

Paste your OpenRouter API key.

Expected after each: `Successfully created secret`.

---

## 6. Step 5 — deploy

```bash
npx wrangler deploy
```

Expected: the output prints your Worker URL, something like:

```
https://telegram-openrouter-bot.<your-subdomain>.workers.dev
```

Copy that URL. It is referred to below as `WORKER_URL`.

---

## 7. Step 6 — register the webhook

One `curl` call tells Telegram where to send updates. Substitute your own
`<BOT_TOKEN>`, `<WORKER_URL>` and `<WEBHOOK_SECRET>`:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>/webhook&secret_token=<WEBHOOK_SECRET>"
```

Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`.

---

## 8. Step 7 — verify

Check what Telegram thinks the webhook is:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

Expected: the `"url"` field matches your `WORKER_URL` + `/webhook`, and there is
no `"last_error_message"` field.

Then open your bot in Telegram and send `/start`. You should get the help text.

---

## 9. Troubleshooting

**`wrangler: command not found` or `You are not authenticated`**
Cause: wrangler is not installed, or you are not logged in.
Fix: run `npm install`, then `npx wrangler login` again.

**`KV namespace ... not found`, or a deploy error mentioning the namespace id**
Cause: the placeholder id is still in `wrangler.toml`.
Fix: re-run step 3 and paste the real 32-hex id into `wrangler.toml`.

**Bot is silent, and `getWebhookInfo` shows
`last_error_message: "Wrong response from the webhook: 401 Unauthorized"`**
Cause: the `TELEGRAM_WEBHOOK_SECRET` secret differs from the `secret_token` you
used in step 6.
Fix: re-run step 6 with the same value, or re-put the secret
(`npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`) and redeploy.

---

## 10. Local dev (optional)

```bash
npx wrangler dev
```

This serves the Worker on `http://localhost:8787`. Telegram cannot reach
localhost, so you also need a tunnel (for example `cloudflared tunnel --url
http://localhost:8787`) and the webhook must point at the tunnel URL, not at
`localhost`.

---

## 11. Known limits

- Cloudflare Workers free plan allows **10 ms of CPU per request**. The bot
  streams the OpenRouter response and never buffers it, so waiting on the
  network does not count against that budget.
- `ctx.waitUntil` keeps the Worker alive for roughly **30 seconds** after the
  `200` response. That is why `max_tokens` defaults to **1024** with a hard cap
  of **2048**.

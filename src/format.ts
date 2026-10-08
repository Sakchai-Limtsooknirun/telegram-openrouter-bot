const FENCE = /```([^\n`]*)\r?\n([\s\S]*?)(?:```|$)/g;
const INLINE_CODE = /`([^`\n]+)`/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toTelegramHtml(md: string): string {
  const slots: string[] = [];
  const hold = (html: string): string => {
    const token = `\u0000${slots.length}\u0000`;
    slots.push(html);
    return token;
  };

  let out = md.replace(FENCE, (_m, lang: string, code: string) => {
    const cls = lang.trim() ? ` class="language-${escapeHtml(lang.trim())}"` : "";
    return hold(`<pre><code${cls}>${escapeHtml(code)}</code></pre>`);
  });

  out = out.replace(INLINE_CODE, (_m, code: string) => hold(`<code>${escapeHtml(code)}</code>`));

  out = escapeHtml(out);

  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*\n]+)\*/g, "<i>$1</i>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => slots[Number(i)] ?? "");
}

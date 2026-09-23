import { escape, type Html } from "./html";

// A small, safe Markdown renderer for the text we read from emails: what Workers AI toMarkdown
// produces (headings, lists, tables, emphasis, links) plus plain text. Every piece of text is
// escaped before any markup is added, and links keep only http, https and mailto URLs, so
// nothing in an email can inject HTML.

/** Renders Markdown as HTML. Headings start at h3, under the page's own h1 and h2. */
export function renderMarkdown(markdown: string): Html {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const at = (n: number): string => lines[n] ?? "";
  while (i < lines.length) {
    const line = at(i);
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(6, (heading[1]?.length ?? 1) + 2);
      out.push(`<h${String(level)}>${inline(heading[2] ?? "")}</h${String(level)}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }
    if (isTableRow(line) && isTableDivider(at(i + 1))) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(at(i))) rows.push(cells(at(i++)));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const pattern = bullet.test(line) ? bullet : numbered;
      const tag = pattern === bullet ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length && pattern.test(at(i))) items.push(at(i++).replace(pattern, ""));
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(at(i))) quoted.push(at(i++).replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(quoted.join("\n")).html}</blockquote>`);
      continue;
    }
    // A paragraph runs to the next blank line or block. Line breaks are kept: emails rely on them.
    const para: string[] = [];
    while (i < lines.length && at(i).trim() !== "" && !startsBlock(at(i), at(i + 1))) {
      para.push(at(i++));
    }
    if (para.length === 0) para.push(at(i++));
    out.push(`<p>${para.map((p) => inline(p.trim())).join("<br />")}</p>`);
  }
  return { html: out.join("\n") };
}

function startsBlock(line: string, next: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*>/.test(line) ||
    (isTableRow(line) && isTableDivider(next))
  );
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|>~])/g;

/** Inline Markdown: backslash escapes, links, bold and italics. Text is escaped first. */
function inline(text: string): string {
  // Hold escaped characters aside so they can't start markup, then put them back as text.
  const held: string[] = [];
  const hold = (s: string): string => `\uE000${String(held.push(s) - 1)}\uE000`;
  let out = escape(text.replace(ESCAPABLE, (_m, c: string) => hold(c)));
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeUrl(url);
    return href === null
      ? label
      : `<a href="${href}" rel="noopener noreferrer nofollow">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
  return out.replace(/\uE000(\d+)\uE000/g, (_m, n: string) => escape(held[Number(n)] ?? ""));
}

/** The URL if it's http, https or mailto; null otherwise (e.g. javascript:). Already escaped. */
function safeUrl(url: string): string | null {
  const raw = url.replaceAll("&amp;", "&");
  return /^(https?:\/\/|mailto:)/i.test(raw) ? escape(raw) : null;
}

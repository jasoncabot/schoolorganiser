import { ITEM_KINDS, type ExtractedItem, type ItemKind } from "./prompt";

/**
 * Turns a Workers AI response into valid items, or null if it's unusable. Models differ in
 * where they put the answer (`response` as an object or a JSON string, or OpenAI-style
 * `choices`), and small models sometimes bend the schema, so every field is checked.
 * Items that don't make sense are dropped rather than failing the whole message.
 */
export function parseExtraction(result: unknown): ExtractedItem[] | null {
  const payload = unwrap(result);
  if (payload === null || typeof payload !== "object" || !("items" in payload)) return null;
  const items = payload.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((raw) => {
    const item = cleanItem(raw);
    return item === null ? [] : [item];
  });
}

function unwrap(result: unknown): unknown {
  if (result === null || typeof result !== "object") return null;
  const r = result as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const candidate = r.response ?? r.choices?.[0]?.message?.content;
  if (typeof candidate === "string") {
    const json = /\{[\s\S]*\}/.exec(candidate)?.[0];
    if (json === undefined) return null;
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return null;
    }
  }
  return candidate ?? null;
}

function cleanItem(raw: unknown): ExtractedItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const date = typeof r.date === "string" && isRealDate(r.date) ? r.date : null;
  const title = text(r.title, 120);
  if (date === null || title === null) return null;
  const kind = ITEM_KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "other";
  const time =
    typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : null;
  return {
    date,
    time,
    kind,
    title,
    cost: text(r.cost, 40),
    location: text(r.location, 120),
    school: text(r.school, 120),
    child: text(r.child, 80),
    confidence: r.confidence === "high" ? "high" : "low",
  };
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || /^(null|none|n\/a)$/i.test(trimmed)) return null;
  return trimmed.slice(0, max);
}

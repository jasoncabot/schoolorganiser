// The extraction request sent to Workers AI. Pure (no Workers APIs), so the model evaluation
// script (scripts/eval-extraction.ts) sends exactly what production sends.

/**
 * The cheapest Workers AI model that extracted every expected item from the fictional letters
 * in test/fixtures/letters (see docs/decisions.md). Re-run `npm run eval:extraction` before
 * changing it.
 */
export const EXTRACTION_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

export const ITEM_KINDS = [
  "event",
  "deadline",
  "payment",
  "kit",
  "timing",
  "closure",
  "other",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ExtractedItem {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24-hour), or null if no time is given. */
  time: string | null;
  kind: ItemKind;
  title: string;
  cost: string | null;
  location: string | null;
  school: string | null;
  child: string | null;
  confidence: "high" | "low";
}

/** Longest email text (subject, body and attachments together) we send to the model. */
export const MAX_INPUT_CHARS = 40_000;

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: ["string", "null"], description: "HH:MM, 24-hour" },
          kind: { type: "string", enum: [...ITEM_KINDS] },
          title: { type: "string" },
          cost: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          school: { type: ["string", "null"] },
          child: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "low"] },
        },
        required: [
          "date",
          "time",
          "kind",
          "title",
          "cost",
          "location",
          "school",
          "child",
          "confidence",
        ],
      },
    },
  },
  required: ["items"],
} as const;

const SYSTEM = `You read letters and emails that UK schools send to parents and list the things a busy parent must know about.

Return JSON: {"items": [...]}. One item per thing that happens or is due on a specific date:
- event: trips, performances, sports days, parents' evenings, discos, assemblies parents can attend
- deadline: forms, consent slips, replies or bookings due by a date
- payment: money due by a date (put the amount in "cost")
- kit: something a child must bring or wear on a date (PE kit, costume, non-uniform, packed lunch)
- timing: an early start, early finish or late pick-up on a date
- closure: school closed (INSET day, strike, bank holiday, snow)
- other: anything else dated that a parent must act on

Rules:
- Only include items with a date you can work out. Skip anything undated.
- Skip regular weekly routines (e.g. "PE is every Tuesday"): they have no single date. Only include a routine if it starts, stops or changes on a specific date, and then only for that date.
- Dates are UK style. Work out the year from the date the email was sent: a date that has already passed that year means next year.
- "date" is YYYY-MM-DD. "time" is HH:MM in 24-hour time, or null.
- "title" is a short British-English phrase, at most 8 words, e.g. "Year 3 trip to Chester Zoo".
- "cost" is the amount as written with its currency, e.g. "£12.50", or null.
- "school" is the school's name if the letter says it, else null.
- "child" is the class, year group or child the item is for if the letter says (e.g. "Year 3", "Oak class"), else null.
- A trip that needs payment and consent by a deadline gives three items: the trip, the payment and the deadline.
- "confidence" is "low" if you had to guess the date or what is needed, else "high".
- Never invent details that aren't in the letter.`;

export interface ExtractionInput {
  /** When the email was sent, as an ISO string. */
  sentAt: string;
  subject: string;
  /** Plain text of the body and attachments. */
  text: string;
}

export function extractionRequest(input: ExtractionInput): Record<string, unknown> {
  const sent = new Date(input.sentAt).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const text =
    input.text.length > MAX_INPUT_CHARS ? input.text.slice(0, MAX_INPUT_CHARS) : input.text;
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Email sent on ${sent}.\nSubject: ${input.subject}\n\n${text}` },
    ],
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
    temperature: 0,
    max_tokens: 2048,
  };
}

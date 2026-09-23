// The extraction request sent to Workers AI. Pure (no Workers APIs), so the model evaluation
// script (scripts/eval-extraction.ts) sends exactly what production sends.

/**
 * The cheapest Workers AI model that extracted every expected item from the fictional letters
 * in test/fixtures/letters (see docs/decisions.md). Re-run `npm run eval:extraction` before
 * changing it.
 */
export const EXTRACTION_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/**
 * Bump when reading or extraction changes in a way worth re-running on stored mail (prompt,
 * model, PDF layout). Messages processed by an older version are re-read the next time the
 * household processes mail. History: 1 first release; 2 unpdf column layout, code-resolved
 * years, larger answers.
 */
export const EXTRACTION_VERSION = 2;

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
/** Room for a full-year calendar (~75 items) in one answer. */
export const MAX_OUTPUT_TOKENS = 8192;

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer", minimum: 1, maximum: 31 },
          month: { type: "integer", minimum: 1, maximum: 12 },
          year: { type: ["integer", "null"], description: "Only if the letter states the year" },
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
          "day",
          "month",
          "year",
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
- Only include items with a specific day and month. Skip anything undated.
- Skip regular weekly routines (e.g. "PE is every Tuesday"): they have no single date. Only include a routine if it starts, stops or changes on a specific date, and then only for that date.
- Dates are UK style (day before month). Give "day" and "month" as numbers. Give "year" only if the letter states it for that date (e.g. "07/09/26" is 2026), otherwise null; never work the year out yourself.
- In calendars and tables, a month heading applies to every date listed under it.
- For a range (e.g. "5th-9th October"), use the first day and say it's a range in the title.
- "time" is HH:MM in 24-hour time, or null.
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
  /** PDF pages as image data URLs, in order. */
  images?: string[];
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
  const intro = `Email sent on ${sent}.\nSubject: ${input.subject}\n\n${text}`;
  const images = input.images ?? [];
  const content =
    images.length === 0
      ? intro
      : [
          {
            type: "text",
            text: `${intro}\n\nThe images are the pages of the PDF attachments, in order. Read dates and tables from the images; use the text above for small print.`,
          },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ];
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
  };
}

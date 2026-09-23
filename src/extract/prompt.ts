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
 * model, PDF layout). Messages read by an older version are re-read on the next processing run.
 */
export const EXTRACTION_VERSION = 6;

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
  /** The letter's weekday doesn't match the date, so the date may be wrong. */
  dateUnsure: boolean;
  /**
   * Names of the household's children this item applies to, as the model gave them, or null when
   * the household had no children set up (then everything counts as relevant).
   */
  forChildren: string[] | null;
  /**
   * Children it may apply to but the model couldn't tell, e.g. an item for "Oak class" when a
   * child at that school has no class set.
   */
  maybeChildren: string[];
}

/** A point worth knowing that has no firm date, e.g. a club on offer or a rule. */
export interface ExtractedNote {
  text: string;
  school: string | null;
  child: string | null;
  forChildren: string[] | null;
  maybeChildren: string[];
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
          weekday: {
            type: ["string", "null"],
            description: "Day of the week, only if the letter states it for this date",
          },
          time: { type: ["string", "null"], description: "HH:MM, 24-hour" },
          kind: { type: "string", enum: [...ITEM_KINDS] },
          title: { type: "string" },
          cost: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          school: { type: ["string", "null"] },
          child: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "low"] },
          for: {
            type: "array",
            items: { type: "string" },
            description: "Names of the household's children this applies to",
          },
          maybe: {
            type: "array",
            items: { type: "string" },
            description: "Names of children it might apply to, when you can't tell",
          },
        },
        required: [
          "day",
          "month",
          "year",
          "weekday",
          "time",
          "kind",
          "title",
          "cost",
          "location",
          "school",
          "child",
          "confidence",
          "for",
          "maybe",
        ],
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "One short point, at most 25 words" },
          school: { type: ["string", "null"] },
          child: { type: ["string", "null"] },
          for: { type: "array", items: { type: "string" } },
          maybe: { type: "array", items: { type: "string" } },
        },
        required: ["text", "school", "child", "for", "maybe"],
      },
    },
  },
  required: ["items", "notes"],
} as const;

const SYSTEM = `You read letters and emails that UK schools send to parents and list the things a busy parent must know about.

Return JSON: {"items": [...], "notes": [...]}.

"items": one per thing that happens or is due on a specific date:
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
- "weekday" is the day of the week exactly as the letter gives it next to this date (e.g. "Tue 14th October" gives "Tuesday"), else null. Never work it out yourself.
- In calendars and tables, a month heading applies to every date listed under it.
- For a range (e.g. "5th-9th October"), use the first day and say it's a range in the title.
- "time" is HH:MM in 24-hour time, or null.
- "title" is a short British-English phrase, at most 8 words, e.g. "Year 3 trip to Chester Zoo".
- "cost" is the amount as written with its currency, e.g. "£12.50", or null.
- "school" is the school's name if the letter says it, else null.
- "child" is the class, year group or child the item is for if the letter says (e.g. "Year 3", "Oak class"), else null.
- A trip that needs payment and consent by a deadline gives three items: the trip, the payment and the deadline.
- "confidence" is "low" if you had to guess the date or what is needed, else "high".
- Never invent details that aren't in the letter.

"notes": up to 5 short points a parent should know that aren't already an item. For example: a club or activity on offer (what, which days, cost, how to book), something to buy, a rule or reminder (no nuts, new pick-up arrangements, uniform changes), or who to contact about something.
- Anything with a specific date is an item, not a note.
- One note per topic: put a club's days, cost, kit and how to book in the same note.
- Each "text" is one plain British-English sentence of at most 25 words, e.g. "Chess club runs on Thursdays at lunchtime, £2 a week; sign up at the school office."
- Keep contact details exactly as written. Never include bank account numbers, sort codes or payment references.
- Skip greetings, sign-offs, history, praise and anything a parent needn't act on or know.
- "school", "child", "for" and "maybe" mean the same as for items.
- If there's nothing worth knowing, "notes" is [].`;

/** A child as the model sees them. */
export interface PromptChild {
  name: string;
  school: string;
  /** e.g. "Year 3", "Reception". */
  yearGroup: string;
  className: string | null;
}

export interface ExtractionInput {
  /** When the email was sent, as an ISO string. */
  sentAt: string;
  subject: string;
  /** Plain text of the body and attachments. */
  text: string;
  /** PDF pages as image data URLs, in order. */
  images?: string[];
  /** The household's children. Empty or missing: every item applies. */
  children?: PromptChild[];
}

function householdSection(children: PromptChild[]): string {
  if (children.length === 0) {
    return `\n\nThis household hasn't told us about its children yet, so give "for" and "maybe" as [] for every item and note.`;
  }
  const lines = children.map(
    (c) =>
      `- ${c.name}: ${c.school}, ${c.yearGroup}${c.className === null ? "" : `, ${c.className} class`}`,
  );
  return `\n\nThis household's children:\n${lines.join("\n")}

"for" lists the names of the children above that the item or note applies to:
- A letter only ever applies to children at the school that sent it. Work out the school from the letter (its name, letterhead or sender). If none of these children go to that school, "for" is [] for every item.
- Whole-school items (INSET days, closures, term dates, events for all pupils) apply to every child above at that school.
- Items for particular year groups, key stages or classes apply only to the children above in them. Nursery and Reception are the early years ("EYFS"); Years 1 and 2 are key stage 1 ("KS1"); Years 3 to 6 are key stage 2 ("KS2"); Years 7 to 9 are key stage 3 ("KS3"); Years 10 and 11 are key stage 4 ("KS4"); "Y3" means Year 3.
- If an item is for a class by name (e.g. "Oak class") and a child above at that school has no class listed, you can't tell whether it's their class: put that child in "maybe", not "for", unless the item's year group rules them out. For example, if Ada has no class listed, an item for "Oak class" at her school has "for": [] and "maybe": ["Ada"]. Otherwise "maybe" is [].
- Use the names exactly as written above.`;
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
      { role: "system", content: SYSTEM + householdSection(input.children ?? []) },
      { role: "user", content },
    ],
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
  };
}

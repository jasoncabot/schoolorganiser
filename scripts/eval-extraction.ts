// Compares Workers AI models on the fictional letters in test/fixtures/letters, using the exact
// request production sends (src/extract/prompt.ts). Run by hand; it calls the real API:
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run eval:extraction -- [model…]
import { readdirSync, readFileSync } from "node:fs";
import { extractionRequest } from "../src/extract/prompt";
import { parseExtraction, parseNotes } from "../src/extract/parse";

interface Expected {
  date: string;
  /** One kind, or the kinds that are all reasonable readings of the letter. */
  kind: string | string[];
  cost?: string;
  /** Words that must appear in the item's "repeats". */
  repeats?: string;
}
interface Letter {
  sentAt: string;
  subject: string;
  text: string;
  expected: Expected[];
  /** Words that must appear in some note, e.g. a club's price. */
  noteIncludes?: string[];
}

const DEFAULT_MODELS = [
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/google/gemma-3-12b-it",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/openai/gpt-oss-20b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (account === undefined || token === undefined)
  throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");

const dir = "test/fixtures/letters";
const letters = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({
    name: f.replace(".json", ""),
    ...(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Letter),
  }));

const repeat = Number(process.env.REPEAT ?? 1);
const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_MODELS;
const normCost = (c: string | null | undefined): string =>
  (c ?? "").replace(/[^0-9.]/g, "").replace(/\.00$/, "");

for (const model of models) {
  let found = 0;
  let expectedTotal = 0;
  let extra = 0;
  let costsRight = 0;
  let costsTotal = 0;
  let failures = 0;
  let neurons = 0;
  let notesRight = 0;
  let notesTotal = 0;
  const notes: string[] = [];
  for (const letter of Array.from({ length: repeat }, () => letters).flat()) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(extractionRequest(letter)),
      },
    );
    const body = (await response.json()) as {
      success: boolean;
      result?: { usage?: { neurons?: number } };
      errors?: unknown;
    };
    neurons += body.result?.usage?.neurons ?? 0;
    const items = body.success
      ? parseExtraction(body.result, letter.sentAt, {
          text: `${letter.subject}\n${letter.text}`,
          complete: true,
        })
      : null;
    if (items === null) {
      failures++;
      expectedTotal += letter.expected.length;
      notes.push(
        `${letter.name}: unusable response ${JSON.stringify(body.errors ?? body.result).slice(0, 160)}`,
      );
      continue;
    }
    const foundNotes = parseNotes(body.result);
    if (process.env.SHOW_NOTES === "1")
      for (const n of foundNotes) notes.push(`${letter.name}: note "${n.text}"`);
    for (const word of letter.noteIncludes ?? []) {
      notesTotal++;
      if (foundNotes.some((n) => n.text.includes(word))) notesRight++;
      else notes.push(`${letter.name}: no note mentions "${word}"`);
    }
    const unmatched = [...items];
    for (const exp of letter.expected) {
      expectedTotal++;
      const i = unmatched.findIndex(
        (it) =>
          it.date === exp.date &&
          ([exp.kind].flat().includes(it.kind) || [exp.kind].flat().includes("other")),
      );
      if (i === -1) {
        notes.push(`${letter.name}: missed ${exp.date} ${[exp.kind].flat().join("/")}`);
        continue;
      }
      found++;
      const [match] = unmatched.splice(i, 1);
      if (process.env.SHOW_NOTES === "1" && match?.repeats != null)
        notes.push(`${letter.name}: repeats "${match.repeats}"`);
      if (exp.repeats !== undefined && !(match?.repeats ?? "").includes(exp.repeats))
        notes.push(`${letter.name}: repeats "${String(match?.repeats)}" lacks "${exp.repeats}"`);
      if (exp.cost !== undefined) {
        costsTotal++;
        if (normCost(match?.cost) === normCost(exp.cost)) costsRight++;
        else notes.push(`${letter.name}: cost ${String(match?.cost)} ≠ ${exp.cost}`);
      }
    }
    // Extras on a date we expected (e.g. a separate kit item for the trip) are fine; other dates aren't.
    const expectedDates = new Set(letter.expected.map((e) => e.date));
    const wrong = unmatched.filter((it) => !expectedDates.has(it.date));
    extra += wrong.length;
    for (const w of wrong)
      notes.push(`${letter.name}: unexpected ${w.date} ${w.kind} "${w.title}"`);
  }
  console.log(
    `\n${model}\n  found ${String(found)}/${String(expectedTotal)}, wrong-date extras ${String(extra)}, costs ${String(costsRight)}/${String(costsTotal)}, notes ${String(notesRight)}/${String(notesTotal)}, unusable ${String(failures)}, neurons ${neurons.toFixed(1)}`,
  );
  for (const n of notes) console.log(`   - ${n}`);
}

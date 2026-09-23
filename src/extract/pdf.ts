import { getDocumentProxy } from "unpdf";

/** Below this many characters per page, assume a scanned PDF and try toMarkdown instead. */
export const MIN_PDF_CHARS_PER_PAGE = 100;

/** A run of text on a PDF page: position of its left edge and baseline, in PDF points. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Text from a PDF's text layer, as "Page N" sections, using unpdf (pdf.js built for serverless),
 * as in Cloudflare's R2 "summarise PDF" tutorial. Workers AI toMarkdown dropped most of the text
 * from a real school newsletter, and plain pdf.js text interleaves columns, so each page is laid
 * out column by column (see layoutPage). Returns null for PDFs with too little text (usually
 * scans) or that can't be read.
 */
export async function readPdfText(bytes: Uint8Array): Promise<string | null> {
  const pages: string[] = [];
  try {
    // pdf.js may detach the buffer it's given, so pass a copy.
    const pdf = await getDocumentProxy(bytes.slice());
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const runs = content.items.flatMap((item): TextRun[] => {
        if (!("str" in item) || item.str.trim() === "") return [];
        return [
          {
            text: item.str,
            x: item.transform[4] as number,
            y: item.transform[5] as number,
            width: item.width,
          },
        ];
      });
      pages.push(layoutPage(runs));
    }
  } catch {
    return null;
  }
  const chars = pages.join("").replace(/\s+/g, "").length;
  if (pages.length === 0 || chars < pages.length * MIN_PDF_CHARS_PER_PAGE) return null;
  return pages.map((page, i) => `Page ${String(i + 1)}\n${page}`).join("\n\n");
}

/** Gaps at least this wide (points) with no text through them separate columns. */
const MIN_GUTTER = 12;
/** Runs whose baselines are within this many points are on the same line. */
const LINE_TOLERANCE = 3;

/**
 * Lays a page's text out in reading order: split into columns at vertical gutters (x ranges
 * that no run crosses), then read each column top to bottom, columns left to right. Runs that
 * span a gutter (titles across the page) are read first, in the order they appear.
 * A calendar grid then reads "SEPTEMBER, its dates, JANUARY, its dates…" instead of mixing
 * months that sit side by side.
 */
export function layoutPage(runs: TextRun[]): string {
  if (runs.length === 0) return "";
  const columns = columnBounds(runs);
  // A run belongs to the column it starts in, unless it reaches well into another column
  // (a title across the page).
  const columnOf = (run: TextRun): number => {
    const reached = columns.filter(
      ([from, to]) => Math.min(to, run.x + run.width) - Math.max(from, run.x) > MIN_GUTTER,
    );
    if (reached.length > 1) return -1;
    const index = columns.findIndex(([from, to]) => run.x >= from - MIN_GUTTER && run.x <= to);
    return index === -1 ? nearestColumn(columns, run.x) : index;
  };
  const spanning = runs.filter((r) => columnOf(r) === -1);
  const groups = [spanning, ...columns.map((_, i) => runs.filter((r) => columnOf(r) === i))];
  return groups
    .map(lines)
    .filter((text) => text !== "")
    .join("\n\n");
}

function nearestColumn(columns: [number, number][], x: number): number {
  let best = 0;
  columns.forEach(([from], i) => {
    if (Math.abs(from - x) < Math.abs((columns[best]?.[0] ?? 0) - x)) best = i;
  });
  return best;
}

/** [from, to] x ranges of the page's text columns, left to right. */
function columnBounds(runs: TextRun[]): [number, number][] {
  const edges = runs
    .map((r) => [r.x, r.x + Math.max(r.width, 1)] as const)
    .sort((a, b) => a[0] - b[0]);
  // Merge overlapping x ranges, ignoring runs wider than 40% of the text's span (titles and
  // full-width paragraphs), which would otherwise hide the gutters between columns.
  const left = Math.min(...runs.map((r) => r.x));
  const right = Math.max(...runs.map((r) => r.x + r.width));
  const wide = (right - left) * 0.4;
  const columns: [number, number][] = [];
  for (const [from, to] of edges) {
    if (to - from > wide) continue;
    const last = columns.at(-1);
    if (last !== undefined && from - last[1] < MIN_GUTTER) last[1] = Math.max(last[1], to);
    else columns.push([from, to]);
  }
  return columns.length === 0 ? [[-Infinity, Infinity]] : columns;
}

/** Joins runs into lines, top to bottom and left to right. */
function lines(runs: TextRun[]): string {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: TextRun[][] = [];
  for (const run of sorted) {
    const line = out.at(-1);
    if (line !== undefined && Math.abs((line[0]?.y ?? 0) - run.y) <= LINE_TOLERANCE) line.push(run);
    else out.push([run]);
  }
  return out
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((r) => r.text.trim())
        .join(" "),
    )
    .join("\n");
}

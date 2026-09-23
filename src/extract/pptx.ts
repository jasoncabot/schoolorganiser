import { unzipSync } from "fflate";

// Workers AI toMarkdown doesn't read PowerPoint, so we unzip .pptx ourselves (it's a zip of XML).

export interface PptxContent {
  /** Slide text, then speaker notes, slide by slide. */
  text: string;
  /** Embedded images, in file-name order. */
  images: { name: string; bytes: Uint8Array }[];
}

const IMAGE = /\.(png|jpe?g|gif|bmp|webp)$/i;

export function readPptx(bytes: Uint8Array): PptxContent {
  const files = unzipSync(bytes);
  const numbered = (pattern: RegExp): [number, string][] =>
    Object.keys(files)
      .flatMap((name): [number, string][] => {
        const n = pattern.exec(name)?.[1];
        return n === undefined ? [] : [[Number(n), name]];
      })
      .sort(([a], [b]) => a - b);

  const decoder = new TextDecoder();
  const read = (name: string): string => {
    const file = files[name];
    return file === undefined ? "" : paragraphs(decoder.decode(file));
  };
  const notes = new Map(
    numbered(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/).map(([n, name]) => [n, read(name)]),
  );

  const text = numbered(/^ppt\/slides\/slide(\d+)\.xml$/)
    .map(([n, name]) => {
      const slide = read(name);
      const note = notes.get(n) ?? "";
      return [`Slide ${String(n)}`, slide, note === "" ? "" : `Notes: ${note}`]
        .filter((s) => s !== "")
        .join("\n");
    })
    .join("\n\n");

  const images = Object.keys(files)
    .filter((name) => name.startsWith("ppt/media/") && IMAGE.test(name))
    .sort()
    .map((name) => ({
      name: name.slice("ppt/media/".length),
      bytes: files[name] ?? new Uint8Array(),
    }));

  return { text, images };
}

/** The text of each <a:p> paragraph (joined <a:t> runs), one per line, skipping empties. */
function paragraphs(xml: string): string {
  const lines: string[] = [];
  for (const [, paragraph = ""] of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const line = [...paragraph.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
      .map(([, t = ""]) => decodeXml(t))
      .join("");
    // Notes pages repeat the slide number as a lone digit; that's noise.
    if (line.trim() !== "" && !/^\d+$/.test(line.trim())) lines.push(line.trim());
  }
  return lines.join("\n");
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

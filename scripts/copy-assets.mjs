// Copies self-hosted third-party files into public/ so Workers static assets serve them from our
// own domain (see CLAUDE.md: no third-party CDNs):
// - the heading font (Inter Tight)
// - pdf.js, used by public/render-pdf.html when Browser Run draws PDF pages as images
import { copyFileSync, mkdirSync } from "node:fs";

const copies = [
  [
    "node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2",
    "public/assets/fonts/inter-tight.woff2",
  ],
  [
    "node_modules/@fontsource-variable/inter-tight/LICENSE",
    "public/assets/fonts/inter-tight-LICENSE.txt",
  ],
  ["node_modules/pdfjs-dist/build/pdf.min.mjs", "public/assets/pdfjs/pdf.min.mjs"],
  ["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/assets/pdfjs/pdf.worker.min.mjs"],
  ["node_modules/pdfjs-dist/LICENSE", "public/assets/pdfjs/LICENSE.txt"],
];
for (const [from, to] of copies) {
  mkdirSync(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  copyFileSync(from, to);
}

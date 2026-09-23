// Copies self-hosted third-party files into public/ so Workers static assets serve them from our
// own domain (see CLAUDE.md: no third-party CDNs):
// - the heading font (Inter Tight)
// - pdf.js (legacy build, for older browser engines) and the files it loads at render time,
//   used by public/render-pdf.html when Browser Run draws PDF pages as images
import { copyFileSync, cpSync, mkdirSync } from "node:fs";

const files = [
  [
    "node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2",
    "public/assets/fonts/inter-tight.woff2",
  ],
  [
    "node_modules/@fontsource-variable/inter-tight/LICENSE",
    "public/assets/fonts/inter-tight-LICENSE.txt",
  ],
  ["node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "public/assets/pdfjs/pdf.min.mjs"],
  [
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    "public/assets/pdfjs/pdf.worker.min.mjs",
  ],
  ["node_modules/pdfjs-dist/LICENSE", "public/assets/pdfjs/LICENSE.txt"],
];
const directories = ["standard_fonts", "cmaps", "wasm", "iccs"];

for (const [from, to] of files) {
  mkdirSync(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  copyFileSync(from, to);
}
for (const dir of directories) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/assets/pdfjs/${dir}`, { recursive: true });
}

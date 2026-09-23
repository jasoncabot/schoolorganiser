// Copies the self-hosted heading font into public/ so Workers static assets can serve it.
// Fonts are served from our own domain: no third-party font CDN (see CLAUDE.md).
import { copyFileSync, mkdirSync } from "node:fs";

const from = "node_modules/@fontsource-variable/inter-tight";
const to = "public/assets/fonts";
mkdirSync(to, { recursive: true });
copyFileSync(`${from}/files/inter-tight-latin-wght-normal.woff2`, `${to}/inter-tight.woff2`);
copyFileSync(`${from}/LICENSE`, `${to}/inter-tight-LICENSE.txt`);

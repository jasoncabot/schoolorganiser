// Builds public/privacy.html from docs/privacy.md, so the notice has one source of truth.
// The page shell matches public/index.html and src/web/html.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";

const body = marked.parse(readFileSync("docs/privacy.md", "utf8"), { async: false });

writeFileSync(
  "public/privacy.html",
  `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Privacy notice – School Organiser</title>
    <link rel="preload" href="/assets/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <a href="#main" class="sr-only focus:not-sr-only">Skip to main content</a>
    <header class="site-header">
      <div class="page py-3">
        <a href="/" class="font-display text-xl font-bold no-underline">School Organiser</a>
      </div>
    </header>
    <main id="main" class="page prose-plain py-10">
${body}
    </main>
  </body>
</html>
`,
);

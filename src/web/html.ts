/** Escapes text for HTML element content and attribute values. */
export function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Marks a string as already-safe HTML. */
export interface Html {
  readonly html: string;
}

/** Tagged template that escapes every interpolated value unless it is already Html. */
export function html(
  strings: TemplateStringsArray,
  ...values: (string | number | Html | Html[])[]
): Html {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      out += typeof part === "object" ? part.html : escape(String(part));
    }
    out += strings[i + 1] ?? "";
  });
  return { html: out };
}

/** The shared page shell. Keep it in step with public/index.html and the privacy page build. */
export function page(title: string, body: Html, status = 200): Response {
  const document = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title} – School Organiser</title>
        <link
          rel="preload"
          href="/assets/fonts/inter-tight.woff2"
          as="font"
          type="font/woff2"
          crossorigin
        />
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body>
        <a href="#main" class="sr-only focus:not-sr-only">Skip to main content</a>
        <header class="border-b-8 border-link bg-brand text-white">
          <div class="page py-3">
            <a
              href="/"
              class="font-display text-xl font-bold text-white no-underline visited:text-white"
              >School Organiser</a
            >
          </div>
        </header>
        <main id="main" class="page py-10">${body}</main>
      </body>
    </html>`;
  return new Response(document.html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

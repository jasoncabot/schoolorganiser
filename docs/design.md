# Web design

Plain, high-contrast and accessible, borrowing the clarity of UK public-service design but not its look. **Nothing may suggest a government service:** no GOV.UK colours, crown, typeface or name.

- **Tailwind CSS v4** (latest 4.x), built with `@tailwindcss/cli` into static assets. Design tokens are defined once in CSS with `@theme`: colours, spacing and type scale.
- **Colours:** plum and cream. Near-black ink `#221a20` on cream `#fdf9f2`; plum header and buttons `#4a2545` with a gold rule `#d9a441`; plum links `#7a2e70`. Error red and success green are used sparingly. Every text colour meets WCAG 2.2 AA (4.5:1) on the backgrounds it's used on.
- **Shapes:** buttons, inputs and panels have 6px rounded corners and no drop shadow. Focus is a 3px plum outline, with a gold highlight on links.
- **Type:** headings use **Inter Tight** (bold, balanced line breaks), which is tighter and more modern than the body text but still plain. Body text uses the system sans-serif stack at 19px on desktop.
- **Fonts are self-hosted.** Inter Tight (OFL) from `@fontsource-variable/inter-tight`, copied into `public/assets/fonts/` by `scripts/copy-assets.mjs`. No font CDNs.
- **Layout:** single column with a narrow reading width, and generous spacing.
- **Components:** reuse a small set everywhere: header, button, text input, summary list, notification banner and error summary.
- **Accessibility:** works without JavaScript where possible, uses semantic HTML, shows visible focus and uses labelled inputs.

## Email

Digests and system emails follow the same look, within what email clients allow:

- Styles are inlined from `COLOURS` in `src/email/outbound.ts`, the same colours as the web page: a plum header bar with a gold rule, cream background and plum links.
- Headings use `"Inter Tight", Arial, Helvetica, sans-serif`, with an `@font-face` pointing at `https://school.jasoncabot.com/assets/fonts/inter-tight.woff2`. Apple Mail and iOS show Inter Tight; Gmail and Outlook ignore web fonts and fall back to Arial, which is fine.
- Body text uses `Arial, Helvetica, sans-serif` at 16px.
- Every email also has a plain-text part.

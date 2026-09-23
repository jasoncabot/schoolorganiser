# Web design

Plain, high-contrast and accessible, in the spirit of UK public-service design. **Don't copy GOV.UK branding:** no crown, no GDS Transport typeface, no "GOV.UK" name, and nothing that suggests it's a government service.

- **Tailwind CSS v4** (latest 4.x), built with `@tailwindcss/cli` into static assets. Design tokens are defined once in CSS with `@theme`: colours, spacing and type scale.
- **Colours:** black text on white, one link blue, and a yellow focus ring. Error red and success green are used sparingly. All combinations meet WCAG 2.2 AA contrast.
- **Type:** headings use **Inter Tight** (bold, balanced line breaks), which is tighter and more modern than the body text but still plain. Body text uses the system sans-serif stack at 19px on desktop.
- **Fonts are self-hosted.** Inter Tight (OFL) from `@fontsource-variable/inter-tight`, copied into `public/assets/fonts/` by `scripts/copy-assets.mjs`. No font CDNs.
- **Layout:** single column with a narrow reading width, and generous spacing.
- **Components:** reuse a small set everywhere: header, button, text input, summary list, notification banner and error summary.
- **Accessibility:** works without JavaScript where possible, uses semantic HTML, shows visible focus and uses labelled inputs.

## Email

Digests and system emails follow the same look, within what email clients allow:

- Styles are inlined, using the same colours as the web page: black text, link blue, and a black header bar with a blue rule.
- Headings use `"Inter Tight", Arial, Helvetica, sans-serif`, with an `@font-face` pointing at `https://school.jasoncabot.com/assets/fonts/inter-tight.woff2`. Apple Mail and iOS show Inter Tight; Gmail and Outlook ignore web fonts and fall back to Arial, which is fine.
- Body text uses `Arial, Helvetica, sans-serif` at 16px.
- Every email also has a plain-text part.

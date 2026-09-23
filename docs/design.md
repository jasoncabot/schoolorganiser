# Web design

Plain, high-contrast and accessible, in the spirit of UK public-service design. **Don't copy GOV.UK branding:** no crown, no GDS Transport typeface, no "GOV.UK" name, and nothing that suggests it's a government service.

- **Tailwind CSS v4** (latest 4.x), built with `@tailwindcss/cli` into static assets. Design tokens are defined once in CSS with `@theme`: colours, spacing and type scale.
- **Colours:** black text on white, one link blue, and a yellow focus ring. Error red and success green are used sparingly. All combinations meet WCAG 2.2 AA contrast.
- **Type:** system sans-serif stack, large body text (19px on desktop), and clear heading sizes.
- **Layout:** single column with a narrow reading width, and generous spacing.
- **Components:** reuse a small set everywhere: header, button, text input, summary list, notification banner and error summary.
- **Accessibility:** works without JavaScript where possible, uses semantic HTML, shows visible focus and uses labelled inputs.

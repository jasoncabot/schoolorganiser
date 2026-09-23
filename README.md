# schoolorganiser

Get a digest of the most important and relevant information from school about your children.

Forward school emails to one address and get a short weekly summary of what's coming up. Built entirely on Cloudflare. See `docs/` for the problem, vision and architecture.

## Development

```sh
npx npm@11 install
cp .dev.vars.example .dev.vars   # placeholder values only
npm run dev                      # local Worker on http://localhost:8787
npm run check                    # lint, types, tests and e2e
```

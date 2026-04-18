# Diagram sources

These PNGs are embedded in the root `README.md` because npmjs.com does not render Mermaid code blocks.

To regenerate after editing any `.mmd` file:

```bash
npx -p @mermaid-js/mermaid-cli npm run docs:diagrams
```

(Or run `mmdc` directly — see the `docs:diagrams` script in `package.json`.)

Puppeteer needs Chrome. If the first run fails with "Could not find Chrome":

```bash
npx puppeteer browsers install chrome-headless-shell
```

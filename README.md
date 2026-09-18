# Energy Calculator Site — Programmatic SEO MVP

A static-site generator that turns structured data (calculator formulas +
appliance database + region data) into a set of standalone, fully-working
solar/battery/energy calculator pages. No backend, no database, no build
framework, no paid API.

This is the MVP phase: **10 core calculators**, built to validate the
calculation engine, content structure, and monetization slots before
expanding into hundreds/thousands of long-tail combinatorial pages.

## Quick start

```bash
npm run build          # runs generate.js, writes the full site to /dist
cd dist && python3 -m http.server 8000
# open http://localhost:8000
```

## Project structure

```
data/
  calculators.json   — the 10 MVP calculator definitions (inputs, formula_id, monetization_type)
  appliances.json     — appliance database (name, typical wattage/hours) — powers the
                         "pick an appliance" dropdown and future long-tail pages
  regions.json         — currency / electricity rate / unit-system defaults per country
                         (not yet wired into the UI — see "Next steps")
lib/
  formula-core.js      — ALL calculation math, pure functions, zero DOM dependency.
                         Used identically at build time (Node) and in the browser
                         (loaded as a script). One place to fix the math.
assets/
  calculator.js         — browser-side glue: reads the form, calls FormulaCore, renders results
  style.css              — site styles, no external font/CDN dependency
generate.js             — the static site generator; validates data, then produces /dist
dist/                     — build output (regenerate any time, don't hand-edit)
```

## Why this architecture

- **formula-core.js is the single source of truth for math.** The generator
  calls it at build time to validate every calculator's defaults actually
  compute without error (`npm run build` fails loudly if a formula is
  broken). The browser calls the *same file* for live recalculation. This
  means the math can never drift between server-rendered and client-side
  behavior.
- **calculators.json only describes UI and metadata** (labels, units,
  defaults, which formula to call, related calculators for internal
  linking, monetization type). It never contains formula logic — that
  separation is what lets you add a new calculator by writing one formula
  function + one JSON entry, without touching the generator.
- **Build-time validation** catches broken data before it ships: duplicate
  slugs, unknown formula references, broken related-calculator links, and
  any calculator whose default inputs throw an error.

## The 10 MVP calculators

1. Battery Runtime — includes 9 battery-spec long-tail pages
2. Battery Size
3. Solar Panel Output
4. Appliance Electricity Cost — includes 25 appliance long-tail pages, region/currency selector
5. Power Consumption — includes 25 appliance long-tail pages
6. Inverter Size
7. Solar System Size
8. Solar Battery Size
9. Solar Payback
10. Generator Size

Total: **270 pages** from 10 calculator definitions + 25 appliances + 9 battery specs + 8 regions (200 of these are region x appliance combos for the cost calculator alone).

Each page: working interactive calculator, plain-language methodology
section, related-calculator internal links, and a monetization slot
(affiliate / lead-gen / ads placeholder depending on `monetization_type`
in calculators.json). Long-tail combo pages also get a baked-in intro
paragraph with real computed numbers specific to that combo.

## Extending the site

**Add a calculator:**
1. Write a pure function in `lib/formula-core.js` (inputs → result object),
   add it to the exports at the bottom.
2. Add an entry to `data/calculators.json` (inputs, formula_id, related
   calculators, monetization type).
3. `npm run build` — validation will catch any mismatch immediately.

**Add appliances:** just append to `data/appliances.json`. Any calculator
with `"supports_appliance_select": true` will automatically pick them up
in its dropdown.

## Before you deploy

Edit the two constants at the top of `generate.js`:

```js
const SITE_NAME = 'WattWise';            // your real site name
const SITE_URL = 'https://example.com';  // your real domain, no trailing slash
```

## Deploying

This repo already includes `.github/workflows/deploy.yml` for GitHub Pages.

**Steps:**
1. Push this repo to GitHub.
2. Edit `SITE_NAME` and `SITE_URL` at the top of `generate.js` to your real domain — the workflow builds with whatever is committed.
3. In your GitHub repo: **Settings → Pages → Source → GitHub Actions**.
4. Push to `main` (or run the workflow manually from the Actions tab) — it builds and deploys automatically. Every future push to `main` redeploys.
5. Once live, submit `https://yourdomain.com/sitemap.xml` to Google Search Console so pages get crawled faster than waiting for organic discovery.

Alternative hosts (also free, same build command): **Cloudflare Pages / Vercel / Netlify** — connect the repo, set build command to `node generate.js` (or `npm run build`), output directory to `dist`.

`robots.txt` is generated automatically and points crawlers to the sitemap.

## Data accuracy note

`data/regions.json` electricity rates were checked against public sources (NERC for Nigeria, globalpetrolprices.com for India/South Africa, general knowledge for the rest) as of this build, but electricity tariffs change often and vary by utility/state/province within a country. Verify current rates before relying on this for real financial decisions, and consider adding a "rates last checked" note if you keep this data long-term. The `usd_per_unit` field is an approximate exchange rate used only to rank the cross-region comparison page fairly (never compare raw currency amounts across different currencies without converting first) — it is not live and should not be treated as a real-time FX rate.

## SEO & duplicate-content safeguards

- Every combo page (appliance, battery-spec, region x appliance) gets a unique `<title>`, meta description, canonical URL, and a `baked-in-summary` intro paragraph computed from real formula output — never a shared template sentence.
- The generic calculator description paragraph appears only on the 10 base calculator pages, not on any combo page, to avoid repeating identical boilerplate across hundreds of pages.
- Region x appliance pages include a computed FAQ (JSON-LD `FAQPage` + visible Q&A) and a cross-region cost comparison, both driven by real numbers — not filler.
- `validate()` in `generate.js` checks for duplicate slugs across appliances/regions/battery-specs AND for two appliances sharing an identical watts+hours profile (which would otherwise generate two pages with identical computed numbers) — the build fails loudly rather than shipping a silent duplicate.
- Every page carries `BreadcrumbList` JSON-LD, Open Graph, and Twitter Card meta tags.
- Cross-currency comparisons are normalized to USD-equivalent before ranking — comparing raw ₦ vs € values would be meaningless.

## Next steps (not yet built)

- **Appliance-specific long-tail pages** — DONE. `/appliance-electricity-cost-calculator/<appliance>/` and `/power-consumption-calculator/<appliance>/`, 25 appliances each, with baked-in computed example numbers per page.
- **Region/currency selector** — DONE, both client-side AND as static pages. Any calculator with a `rate_per_kwh` input shows a region dropdown for live recalculation, AND the appliance-electricity-cost calculator generates a dedicated static page per appliance x region combo (e.g. `/appliance-electricity-cost-calculator/refrigerator/nigeria/`) with baked-in numbers computed at that region's real rate — so each region gets its own indexable URL, not just a client-side toggle.
- **Battery/load combinatorial pages** — DONE. `/battery-runtime-calculator/<voltage>v-<capacity>ah/` for 9 curated common battery specs, each with baked-in runtime estimates at 3 representative loads (100W/300W/1000W).
- **Real monetization integrations** — replace the placeholder
  `monetization-slot` markup in `generate.js` with actual affiliate
  product cards / lead-capture forms / ad network snippets once programs
  are approved.
- **`content/` directory** — per-calculator methodology/assumptions/FAQ
  markdown that gets real computed example numbers injected at build
  time, to keep pages from reading as thin/templated once the site scales
  past the MVP (partially achieved already via the baked-in-summary
  sections on combo pages — this would extend the same idea to the base
  calculator pages too).
- **Region x appliance combinatorial pages** — DONE. 200 pages (25 appliances × 8 regions) for the appliance-electricity-cost calculator.
- **`/appliances/` and `/batteries/` category index pages** for easier crawling.
- **Battery-size and solar-battery-size long-tail pages** — currently only
  battery-runtime has spec-based combo pages; the same pattern could
  extend to the other battery calculators.

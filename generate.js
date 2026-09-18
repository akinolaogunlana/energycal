#!/usr/bin/env node
/**
 * generate.js — builds the full static site into /dist.
 * Run: npm run build
 */

const fs = require('fs');
const path = require('path');

// ---- config -----------------------------------------------------------
const SITE_NAME = 'WattWise'; // TODO: change before deploying
const SITE_URL = 'https://example.com'; // TODO: change before deploying, no trailing slash

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ---- load data ----------------------------------------------------------
const calculators = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/calculators.json'), 'utf8'));
const appliances = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/appliances.json'), 'utf8'));
const regions = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/regions.json'), 'utf8'));
const batterySpecs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/battery-specs.json'), 'utf8'));
const FormulaCore = require('./lib/formula-core.js');

const calcBySlug = Object.fromEntries(calculators.map(c => [c.slug, c]));
const applianceBySlug = Object.fromEntries(appliances.map(a => [a.slug, a]));
const DEFAULT_REGION = regions.find(r => r.code === 'US') || regions[0];

// ---- combinatorial filter -------------------------------------------------
// Guards against generating pages with no genuine utility. Right now every
// appliance is curated by hand so every combo passes, but this is the single
// place future combinatorial expansion (battery x load, region x appliance,
// etc.) must run through before a page gets generated.
function isUsefulApplianceCombo(calc, appliance) {
  if (!calc.supports_appliance_select) return false;
  if (!appliance.typical_watts || appliance.typical_watts <= 0) return false;
  if (!appliance.typical_hours_per_day || appliance.typical_hours_per_day <= 0) return false;
  return true;
}

function isUsefulBatterySpecCombo(calc, spec) {
  if (!calc.supports_battery_spec) return false;
  if (!spec.voltage || spec.voltage <= 0) return false;
  if (!spec.capacity_ah || spec.capacity_ah <= 0) return false;
  return true;
}

function calcHasCurrencyInput(calc) {
  return calc.inputs.some(i => i.id === 'rate_per_kwh');
}

function isUsefulRegionApplianceCombo(calc, appliance, region) {
  if (!isUsefulApplianceCombo(calc, appliance)) return false;
  if (!calcHasCurrencyInput(calc)) return false;
  if (!region.avg_electricity_rate_per_kwh || region.avg_electricity_rate_per_kwh <= 0) return false;
  return true;
}

// Short, genuinely differentiated editorial notes by appliance category —
// combined with per-page computed numbers (FAQ, comparisons), this keeps
// the boilerplate-to-unique-content ratio low even at hundreds of pages.
// A handful of appliances sharing a category note is normal editorial
// practice (any publication groups by category); it is never the only
// unique content on a page.
const CATEGORY_TIPS = {
  kitchen: "Kitchen appliances like this often cycle on and off rather than running continuously, so your real-world cost can be lower than a naive full-time estimate.",
  cooling: "Cooling appliances draw more in hot weather and less (or not at all) in cooler months, so your annual cost will vary by season.",
  electronics: "Electronics often draw a small amount of standby power even when switched off — a smart plug can shave a little more off the total.",
  laundry: "Laundry appliances are usually used in short, high-power bursts rather than for hours at a time, so the daily estimate is sensitive to how many loads you actually run.",
  heating: "Heating appliances are some of the most power-hungry devices in a home — small changes in daily usage hours have an outsized effect on the monthly cost.",
  utility: "Utility devices like this often run on a duty cycle rather than continuously, so metering your actual usage will give a more accurate figure than the typical-use default.",
  lighting: "If you haven't already switched to LED, that's usually the cheapest way to cut lighting costs further on top of this estimate.",
  security: "Security devices typically run 24/7, so small wattage differences between models add up meaningfully over a year.",
  'personal-care': "Personal care appliances are usually used briefly each day, so their overall share of your bill is often smaller than their wattage alone suggests."
};

function categoryTip(appliance) {
  return CATEGORY_TIPS[appliance.category] || '';
}

// ---- validation (fail the build on bad data rather than ship junk) ----
function validate() {
  const errors = [];
  const seenSlugs = new Set();
  for (const c of calculators) {
    if (seenSlugs.has(c.slug)) errors.push(`Duplicate calculator slug: ${c.slug}`);
    seenSlugs.add(c.slug);
    if (!FormulaCore[c.formula_id]) errors.push(`${c.slug}: unknown formula_id "${c.formula_id}"`);
    if (!Array.isArray(c.inputs) || c.inputs.length === 0) errors.push(`${c.slug}: no inputs defined`);
    for (const rel of c.related_calculators || []) {
      if (!calculators.find(x => x.slug === rel)) {
        errors.push(`${c.slug}: related_calculators references unknown slug "${rel}"`);
      }
    }
    // sanity-check the formula actually runs on its own defaults
    try {
      const defaults = Object.fromEntries(c.inputs.map(i => [i.id, i.default]));
      FormulaCore[c.formula_id](defaults);
    } catch (e) {
      errors.push(`${c.slug}: formula throws on default inputs — ${e.message}`);
    }
  }
  if (errors.length) {
    console.error('Build failed — data validation errors:\n' + errors.map(e => ' - ' + e).join('\n'));
    process.exit(1);
  }

  // Cross-dataset slug hygiene: catches silent overwrite bugs where two
  // entries would generate the same URL, and catches accidental near-dupe
  // appliances (same watts/hours under different names, which would
  // produce two pages with identical baked-in numbers and near-identical
  // copy — a real duplicate-content risk, not just a data bug).
  const combErrors = [];
  const applianceSlugs = new Set();
  for (const a of appliances) {
    if (applianceSlugs.has(a.slug)) combErrors.push(`Duplicate appliance slug: ${a.slug}`);
    applianceSlugs.add(a.slug);
  }
  const seenApplianceProfiles = new Map();
  for (const a of appliances) {
    const profile = `${a.typical_watts}|${a.typical_hours_per_day}`;
    if (seenApplianceProfiles.has(profile)) {
      combErrors.push(`Appliances "${seenApplianceProfiles.get(profile)}" and "${a.slug}" share identical watts+hours — their generated pages will have identical computed numbers. Differentiate the values or merge them.`);
    } else {
      seenApplianceProfiles.set(profile, a.slug);
    }
  }
  const regionSlugs = new Set();
  for (const r of regions) {
    if (regionSlugs.has(r.slug)) combErrors.push(`Duplicate region slug: ${r.slug}`);
    regionSlugs.add(r.slug);
  }
  const specSlugs = new Set();
  for (const s of batterySpecs) {
    if (specSlugs.has(s.slug)) combErrors.push(`Duplicate battery-spec slug: ${s.slug}`);
    specSlugs.add(s.slug);
  }
  if (combErrors.length) {
    console.error('Build failed — cross-dataset validation errors:\n' + combErrors.map(e => ' - ' + e).join('\n'));
    process.exit(1);
  }
}// ---- helpers ------------------------------------------------------------
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

function monetizationSlot(calc) {
  // Placeholder markup — swap in real affiliate/lead/ad snippets once
  // programs are approved. Kept in one place so strategy can change
  // without touching every page template.
  const type = calc.monetization_type;
  if (type === 'lead') {
    return `<div class="monetization-slot lead-slot" data-calc="${calc.slug}">
      <p class="slot-label">Want a real quote based on this result?</p>
      <button class="cta-button" type="button" disabled>Get quotes (coming soon)</button>
    </div>`;
  }
  if (type === 'affiliate' || type === 'ads_affiliate') {
    return `<div class="monetization-slot affiliate-slot" data-calc="${calc.slug}">
      <p class="slot-label">Recommended products for this result</p>
      <div class="affiliate-placeholder">Affiliate product cards go here</div>
    </div>`;
  }
  return `<div class="monetization-slot ad-slot" data-calc="${calc.slug}">
    <div class="ad-placeholder">Ad slot</div>
  </div>`;
}

function relatedLinksHtml(calc) {
  const rel = (calc.related_calculators || []).map(slug => {
    const target = calcBySlug[slug];
    if (!target) return '';
    return `<li><a href="/${target.slug}/">${escapeHtml(target.title)}</a></li>`;
  }).join('\n');
  if (!rel) return '';
  return `<nav class="related-calculators">
    <h2>Related calculators</h2>
    <ul>${rel}</ul>
  </nav>`;
}

function applianceLinksHtml(calc) {
  if (!calc.supports_appliance_select) return '';
  const usable = appliances.filter(a => isUsefulApplianceCombo(calc, a));
  if (!usable.length) return '';
  const items = usable.map(a => `<li><a href="/${calc.slug}/${a.slug}/">${escapeHtml(a.name)}</a></li>`).join('\n');
  return `<nav class="appliance-links">
    <h2>Cost by appliance</h2>
    <ul>${items}</ul>
  </nav>`;
}

function batterySpecLinksHtml(calc) {
  if (!calc.supports_battery_spec) return '';
  const usable = batterySpecs.filter(s => isUsefulBatterySpecCombo(calc, s));
  if (!usable.length) return '';
  const items = usable.map(s => `<li><a href="/${calc.slug}/${s.slug}/">${s.voltage}V ${s.capacity_ah}Ah battery</a></li>`).join('\n');
  return `<nav class="battery-spec-links">
    <h2>Runtime by battery size</h2>
    <ul>${items}</ul>
  </nav>`;
}

function regionLinksHtml(calc, appliance) {
  if (!calcHasCurrencyInput(calc)) return '';
  const usable = regions.filter(r => isUsefulRegionApplianceCombo(calc, appliance, r));
  if (!usable.length) return '';
  const items = usable.map(r => `<li><a href="/${calc.slug}/${appliance.slug}/${r.slug}/">${escapeHtml(r.name)}</a></li>`).join('\n');
  return `<nav class="region-links">
    <h2>Cost by country</h2>
    <ul>${items}</ul>
  </nav>`;
}

function backLinkHtml(calc) {
  return `<p class="back-link"><a href="/${calc.slug}/">&larr; ${escapeHtml(calc.title)} (custom values)</a></p>`;
}

// ---- structured data & FAQ (real computed content, not filler) -----------

function breadcrumbJsonLd(items) {
  // items: [{name, url}], in order from home to current page
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url
    }))
  });
}

function faqJsonLd(qaList) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qaList.map(qa => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a }
    }))
  });
}

function faqSectionHtml(qaList) {
  if (!qaList.length) return '';
  const items = qaList.map(qa => `
    <div class="faq-item">
      <h3>${escapeHtml(qa.q)}</h3>
      <p>${escapeHtml(qa.a)}</p>
    </div>`).join('\n');
  return `<section class="faq">
    <h2>Common questions</h2>
    ${items}
  </section>
  <script type="application/ld+json">${faqJsonLd(qaList)}</script>`;
}

// Real computed Q&A for appliance cost pages — every number here comes from
// FormulaCore, so two appliances (or the same appliance in two regions)
// produce genuinely different answers, not a reworded template.
function applianceCostFaq(appliance, region) {
  const qa = [];
  try {
    const base = FormulaCore.appliance_cost({
      watts: appliance.typical_watts,
      hours_per_day: appliance.typical_hours_per_day,
      rate_per_kwh: region.avg_electricity_rate_per_kwh
    });
    qa.push({
      q: `How much does it cost per year to run a ${appliance.name.toLowerCase()}?`,
      a: `At typical usage of ${appliance.typical_hours_per_day} hours a day and ${region.currency_symbol}${region.avg_electricity_rate_per_kwh}/kWh, a ${appliance.name.toLowerCase()} costs approximately ${region.currency_symbol}${base.annual_cost} per year to run.`
    });

    const allDay = FormulaCore.appliance_cost({
      watts: appliance.typical_watts,
      hours_per_day: 24,
      rate_per_kwh: region.avg_electricity_rate_per_kwh
    });
    qa.push({
      q: `What would it cost to run a ${appliance.name.toLowerCase()} 24 hours a day?`,
      a: `Running it continuously instead of the typical ${appliance.typical_hours_per_day} hours a day would cost about ${region.currency_symbol}${allDay.daily_cost}/day, or ${region.currency_symbol}${allDay.monthly_cost}/month — ${region.currency_symbol}${round2(allDay.monthly_cost - base.monthly_cost)} more than typical usage.`
    });
  } catch (e) { /* skip on formula error */ }
  return qa;
}

function round2(n) { return Math.round(n * 100) / 100; }

// Compares the same appliance's cost across every region in the dataset —
// genuinely different ranking/numbers per appliance since wattage scales
// the rate difference. This is the block that makes each of the 200
// region x appliance pages carry real comparative data, not just a
// currency-swapped sentence.
function regionComparisonHtml(calc, appliance, currentRegion) {
  const usable = regions.filter(r => isUsefulRegionApplianceCombo(calc, appliance, r));
  if (usable.length < 2) return '';
  const withCost = usable.map(r => {
    const result = FormulaCore.appliance_cost({
      watts: appliance.typical_watts,
      hours_per_day: appliance.typical_hours_per_day,
      rate_per_kwh: r.avg_electricity_rate_per_kwh
    });
    const usdPerUnit = r.usd_per_unit != null ? r.usd_per_unit : 1;
    return { region: r, monthlyCost: result.monthly_cost, monthlyCostUsd: round2(result.monthly_cost * usdPerUnit) };
  }).sort((a, b) => a.monthlyCostUsd - b.monthlyCostUsd);

  const cheapest = withCost[0];
  const priciest = withCost[withCost.length - 1];
  const rank = withCost.findIndex(w => w.region.code === currentRegion.code) + 1;

  const rows = withCost.map(w => `<li${w.region.code === currentRegion.code ? ' class="current-region"' : ''}>${escapeHtml(w.region.name)}: ${w.region.currency_symbol}${w.monthlyCost}/month (~$${w.monthlyCostUsd} USD)${w.region.code === currentRegion.code ? ' — this page' : ''}</li>`).join('\n');

  return `<section class="region-comparison">
    <h2>How ${escapeHtml(currentRegion.name)} compares</h2>
    <p>Converted to a common currency (USD) so the comparison is apples-to-apples, running a ${escapeHtml(appliance.name.toLowerCase())} at typical usage costs the least in ${escapeHtml(cheapest.region.name)} (~$${cheapest.monthlyCostUsd}/month) and the most in ${escapeHtml(priciest.region.name)} (~$${priciest.monthlyCostUsd}/month) among the regions we track. ${escapeHtml(currentRegion.name)} ranks ${rank} of ${withCost.length} by USD-equivalent cost.</p>
    <ul class="region-comparison-list">${rows}</ul>
    <p class="fx-disclaimer">USD equivalents use approximate exchange rates for comparison only, not live rates — local currency amounts (and the electricity rates behind them) are the figures to rely on.</p>
  </section>`;
}

function inputsFormHtml(calc, prefill) {
  const fields = calc.inputs.map(input => {
    const value = (prefill && prefill[input.id] != null) ? prefill[input.id] : input.default;
    return `
    <label class="field">
      <span class="field-label">${escapeHtml(input.label)}${input.unit ? ` (${escapeHtml(input.unit)})` : ''}</span>
      <input
        type="number"
        id="${input.id}"
        name="${input.id}"
        value="${value}"
        ${input.min != null ? `min="${input.min}"` : ''}
        ${input.max != null ? `max="${input.max}"` : ''}
        step="any"
        required
      />
    </label>`;
  }).join('\n');

  const applianceSelect = calc.supports_appliance_select ? `
    <label class="field appliance-select-field">
      <span class="field-label">Or pick a common appliance</span>
      <select id="appliance-select">
        <option value="">-- Custom values --</option>
        ${appliances.map(a => `<option value="${a.slug}" data-watts="${a.typical_watts}" data-hours="${a.typical_hours_per_day}" ${prefill && prefill.__applianceSlug === a.slug ? 'selected' : ''}>${escapeHtml(a.name)} (~${a.typical_watts}W)</option>`).join('\n')}
      </select>
    </label>` : '';

  // Only calculators with a rate_per_kwh input have a currency-denominated
  // result, so only those get a region selector.
  const selectedRegionCode = (prefill && prefill.__regionCode) || DEFAULT_REGION.code;
  const regionSelect = calcHasCurrencyInput(calc) ? `
    <label class="field region-select-field">
      <span class="field-label">Region (sets electricity rate &amp; currency)</span>
      <select id="region-select">
        ${regions.map(r => `<option value="${r.code}" data-rate="${r.avg_electricity_rate_per_kwh}" data-symbol="${r.currency_symbol}" ${r.code === selectedRegionCode ? 'selected' : ''}>${escapeHtml(r.name)} (${r.currency_symbol}${r.avg_electricity_rate_per_kwh}/kWh avg)</option>`).join('\n')}
      </select>
    </label>` : '';

  const currentRegion = regions.find(r => r.code === selectedRegionCode) || DEFAULT_REGION;

  return `<form id="calculator-form" data-formula="${calc.formula_id}" data-currency-symbol="${currentRegion.currency_symbol}">
    ${applianceSelect}
    ${regionSelect}
    ${fields}
    <button type="submit" class="calculate-button">Calculate</button>
  </form>
  <div id="result" class="result" aria-live="polite"></div>`;
}

function pageTemplate(calc, opts) {
  opts = opts || {};
  const appliance = opts.appliance || null;
  const batterySpec = opts.batterySpec || null;
  const region = opts.region || null; // only meaningful alongside `appliance`
  const comboSlug = appliance ? appliance.slug : (batterySpec ? batterySpec.slug : null);
  const regionSlug = (appliance && region) ? region.slug : null;
  const slugPath = regionSlug ? `${calc.slug}/${comboSlug}/${regionSlug}` : (comboSlug ? `${calc.slug}/${comboSlug}` : calc.slug);
  const canonical = `${SITE_URL}/${slugPath}/`;

  let title = calc.title;
  let metaDescription = calc.description;
  let prefill = null;
  let intro = '';
  let faqQa = [];
  let extraSection = '';

  if (appliance && region) {
    title = `${appliance.name} Electricity Cost in ${region.name} — ${calc.title}`;
    metaDescription = `How much does a ${appliance.name.toLowerCase()} cost to run in ${region.name}? Real numbers at ${region.currency_symbol}${region.avg_electricity_rate_per_kwh}/kWh, the local average rate.`;
    prefill = {
      watts: appliance.typical_watts,
      hours_per_day: appliance.typical_hours_per_day,
      rate_per_kwh: region.avg_electricity_rate_per_kwh,
      __applianceSlug: appliance.slug,
      __regionCode: region.code
    };
    intro = bakedInApplianceIntro(calc, appliance, region);
    faqQa = applianceCostFaq(appliance, region);
    extraSection = regionComparisonHtml(calc, appliance, region);
  } else if (appliance) {
    title = `${appliance.name} Electricity Cost — ${calc.title}`;
    metaDescription = `How much does a ${appliance.name.toLowerCase()} (~${appliance.typical_watts}W) cost to run per day, month, and year at typical usage.`;
    prefill = { watts: appliance.typical_watts, hours_per_day: appliance.typical_hours_per_day, __applianceSlug: appliance.slug };
    intro = bakedInApplianceIntro(calc, appliance, DEFAULT_REGION);
    if (calcHasCurrencyInput(calc)) faqQa = applianceCostFaq(appliance, DEFAULT_REGION);
  } else if (batterySpec) {
    title = `${batterySpec.voltage}V ${batterySpec.capacity_ah}Ah Battery Runtime — ${calc.title}`;
    metaDescription = `How long does a ${batterySpec.voltage}V ${batterySpec.capacity_ah}Ah ${batterySpec.chemistry} battery last? Runtime at common load levels, calculated.`;
    prefill = { capacity_ah: batterySpec.capacity_ah, voltage: batterySpec.voltage };
    intro = bakedInBatterySpecIntro(calc, batterySpec);
    faqQa = batterySpecFaq(batterySpec);
  }

  const backHref = regionSlug ? `/${calc.slug}/${comboSlug}/` : `/${calc.slug}/`;
  const backLabel = regionSlug ? `${appliance.name} (default region)` : `${calc.title} (custom values)`;

  // Breadcrumbs — genuinely differ per page depth, and give crawlers a
  // second, structured signal of where this page sits in the site.
  const breadcrumbItems = [{ name: SITE_NAME, url: `${SITE_URL}/` }, { name: calc.title, url: `${SITE_URL}/${calc.slug}/` }];
  if (appliance) breadcrumbItems.push({ name: appliance.name, url: `${SITE_URL}/${calc.slug}/${appliance.slug}/` });
  if (batterySpec) breadcrumbItems.push({ name: `${batterySpec.voltage}V ${batterySpec.capacity_ah}Ah`, url: `${SITE_URL}/${calc.slug}/${batterySpec.slug}/` });
  if (region) breadcrumbItems.push({ name: region.name, url: canonical });

  const categoryTipHtml = appliance && categoryTip(appliance)
    ? `<p class="category-tip">${escapeHtml(categoryTip(appliance))}</p>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="index, follow" />
  <title>${escapeHtml(title)} — ${SITE_NAME}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(metaDescription)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}" />
  <link rel="stylesheet" href="/assets/style.css" />
  <script type="application/ld+json">${breadcrumbJsonLd(breadcrumbItems)}</script>
</head>
<body>
  <header class="site-header">
    <a href="/" class="logo">${SITE_NAME}</a>
  </header>

  <main class="calculator-page">
    ${comboSlug ? `<p class="back-link"><a href="${backHref}">&larr; ${escapeHtml(backLabel)}</a></p>` : ''}
    <h1>${escapeHtml(title)}</h1>
    ${!comboSlug ? `<p class="description">${escapeHtml(calc.description)}</p>` : ''}
    ${intro}
    ${categoryTipHtml}

    <section class="calculator-widget">
      ${inputsFormHtml(calc, prefill)}
    </section>

    ${monetizationSlot(calc)}

    ${extraSection}

    ${faqSectionHtml(faqQa)}

    <section class="methodology">
      <h2>How this is calculated</h2>
      <p>This calculator uses standard electrical formulas applied to the values above. Results are estimates — real-world performance varies with equipment efficiency, temperature, and usage patterns${appliance ? `. The default wattage and daily usage shown are typical for a ${appliance.name.toLowerCase()}, but check your own device's rating label for an exact figure.` : ''}${batterySpec ? `. Real-world runtime is usually a bit lower than the theoretical figure due to inverter losses and battery aging.` : ''}${!appliance && !batterySpec ? '.' : ''}${region ? ` Electricity rates within ${escapeHtml(region.name)} vary by utility and season, so treat ${region.currency_symbol}${region.avg_electricity_rate_per_kwh}/kWh as a starting estimate, not your exact bill.` : ''}</p>
    </section>

    ${!comboSlug ? applianceLinksHtml(calc) : ''}
    ${!comboSlug ? batterySpecLinksHtml(calc) : ''}
    ${(appliance && !regionSlug) ? regionLinksHtml(calc, appliance) : ''}
    ${relatedLinksHtml(calc)}
  </main>

  <footer class="site-footer">
    <p>&copy; ${new Date().getFullYear()} ${SITE_NAME}. Estimates only — not a substitute for a professional assessment.</p>
  </footer>

  <script src="/assets/formula-core.js"></script>
  <script src="/assets/calculator.js"></script>
</body>
</html>`;
}

// Builds a short, genuinely calculated intro paragraph per appliance page —
// real numbers from FormulaCore run at build time, not a template with
// swapped-in variables. This is the content-quality safeguard: two
// appliance pages read differently because their computed results differ,
// not just because a noun was substituted into a fixed sentence. Region is
// now a parameter (not hardcoded to DEFAULT_REGION) so the same function
// powers both the default-region appliance page and each region-specific
// combo page with genuinely different currency/rate numbers.
function bakedInApplianceIntro(calc, appliance, region) {
  const rate = region.avg_electricity_rate_per_kwh;
  const inputs = {
    watts: appliance.typical_watts,
    hours_per_day: appliance.typical_hours_per_day,
    rate_per_kwh: rate
  };
  let result;
  try {
    result = FormulaCore.appliance_cost(inputs);
  } catch (e) {
    return '';
  }
  const notes = appliance.notes ? ` ${appliance.notes}` : '';
  const regionPhrase = region.code === DEFAULT_REGION.code ? 'an average' : `${escapeHtml(region.name)}'s average`;
  return `<section class="baked-in-summary">
    <p>A typical ${escapeHtml(appliance.name.toLowerCase())} draws around <strong>${appliance.typical_watts}W</strong> and runs roughly <strong>${appliance.typical_hours_per_day} hours a day</strong>. At ${regionPhrase} rate of ${region.currency_symbol}${rate}/kWh, that works out to about <strong>${region.currency_symbol}${result.daily_cost}/day</strong>, or <strong>${region.currency_symbol}${result.monthly_cost}/month</strong>.${notes} Adjust the values below to match your own appliance's rating label and usage.</p>
  </section>`;
}

// Same principle as bakedInApplianceIntro: real computed runtimes at a
// handful of representative loads, per battery spec, so each spec page has
// genuinely different numbers rather than a swapped voltage/capacity string.
function bakedInBatterySpecIntro(calc, spec) {
  const exampleLoads = [100, 300, 1000]; // watts — small electronics, mid appliance, heavy load
  const lines = exampleLoads.map(loadWatts => {
    try {
      const result = FormulaCore.battery_runtime({
        capacity_ah: spec.capacity_ah,
        voltage: spec.voltage,
        load_watts: loadWatts,
        depth_of_discharge: 80
      });
      return `<li>At ${loadWatts}W: roughly <strong>${result.runtime_hours} hours</strong></li>`;
    } catch (e) {
      return '';
    }
  }).join('');

  return `<section class="baked-in-summary">
    <p>A ${spec.voltage}V ${spec.capacity_ah}Ah battery (${escapeHtml(spec.chemistry)}) is commonly used for ${escapeHtml(spec.common_use)}. Assuming an 80% usable depth of discharge, here's roughly how long it lasts at a few common load levels:</p>
    <ul>${lines}</ul>
    <p>Enter your own load below for an exact figure.</p>
  </section>`;
}

// Same principle as bakedInBatterySpecIntro: real computed answers, not a
// reworded template — two battery specs produce genuinely different hours.
function batterySpecFaq(spec) {
  const qa = [];
  try {
    const laptop = FormulaCore.battery_runtime({ capacity_ah: spec.capacity_ah, voltage: spec.voltage, load_watts: 60, depth_of_discharge: 80 });
    qa.push({
      q: `How long will a ${spec.voltage}V ${spec.capacity_ah}Ah battery run a laptop?`,
      a: `At a typical laptop draw of 60W, this battery lasts roughly ${laptop.runtime_hours} hours at 80% usable depth of discharge.`
    });
    const fridge = FormulaCore.battery_runtime({ capacity_ah: spec.capacity_ah, voltage: spec.voltage, load_watts: 150, depth_of_discharge: 80 });
    qa.push({
      q: `How long will this battery run a refrigerator?`,
      a: `At a typical refrigerator draw of 150W, this battery lasts roughly ${fridge.runtime_hours} hours before needing a recharge, assuming 80% usable depth of discharge.`
    });
    const full = FormulaCore.battery_runtime({ capacity_ah: spec.capacity_ah, voltage: spec.voltage, load_watts: 1, depth_of_discharge: 80 });
    qa.push({
      q: `How much usable energy does a ${spec.voltage}V ${spec.capacity_ah}Ah battery store?`,
      a: `At 80% usable depth of discharge, it provides approximately ${full.usable_energy_wh}Wh (${round2(full.usable_energy_wh / 1000)}kWh) of usable energy.`
    });
  } catch (e) { /* skip on formula error */ }
  return qa;
}

function indexTemplate() {
  const byCategory = {};
  for (const c of calculators) {
    byCategory[c.category] = byCategory[c.category] || [];
    byCategory[c.category].push(c);
  }
  const sections = Object.entries(byCategory).map(([cat, calcs]) => `
    <section class="category-group">
      <h2>${escapeHtml(cat)}</h2>
      <ul>
        ${calcs.map(c => `<li><a href="/${c.slug}/">${escapeHtml(c.title)}</a> — ${escapeHtml(c.description)}</li>`).join('\n')}
      </ul>
    </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="index, follow" />
  <title>${SITE_NAME} — Solar, Battery &amp; Energy Calculators</title>
  <meta name="description" content="Free calculators for solar sizing, battery runtime, inverter sizing, and electricity costs." />
  <link rel="canonical" href="${SITE_URL}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${SITE_NAME} — Solar, Battery &amp; Energy Calculators" />
  <meta property="og:description" content="Free calculators for solar sizing, battery runtime, inverter sizing, and electricity costs." />
  <meta property="og:url" content="${SITE_URL}/" />
  <link rel="stylesheet" href="/assets/style.css" />
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` })}</script>
</head>
<body>
  <header class="site-header">
    <a href="/" class="logo">${SITE_NAME}</a>
  </header>
  <main class="home-page">
    <h1>${SITE_NAME}</h1>
    <p>Free calculators for solar, battery, and home energy planning.</p>
    ${sections}
  </main>
  <footer class="site-footer">
    <p>&copy; ${new Date().getFullYear()} ${SITE_NAME}</p>
  </footer>
</body>
</html>`;
}

function sitemapXml() {
  const applianceUrls = [];
  for (const calc of calculators) {
    if (!calc.supports_appliance_select) continue;
    for (const appliance of appliances) {
      if (isUsefulApplianceCombo(calc, appliance)) {
        applianceUrls.push(`${SITE_URL}/${calc.slug}/${appliance.slug}/`);
      }
    }
  }
  const batterySpecUrls = [];
  for (const calc of calculators) {
    if (!calc.supports_battery_spec) continue;
    for (const spec of batterySpecs) {
      if (isUsefulBatterySpecCombo(calc, spec)) {
        batterySpecUrls.push(`${SITE_URL}/${calc.slug}/${spec.slug}/`);
      }
    }
  }
  const regionApplianceUrls = [];
  for (const calc of calculators) {
    if (!calcHasCurrencyInput(calc) || !calc.supports_appliance_select) continue;
    for (const appliance of appliances) {
      for (const region of regions) {
        if (isUsefulRegionApplianceCombo(calc, appliance, region)) {
          regionApplianceUrls.push(`${SITE_URL}/${calc.slug}/${appliance.slug}/${region.slug}/`);
        }
      }
    }
  }
  const urls = [`${SITE_URL}/`, ...calculators.map(c => `${SITE_URL}/${c.slug}/`), ...applianceUrls, ...batterySpecUrls, ...regionApplianceUrls];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
}

function robotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

// ---- build ---------------------------------------------------------------
function build() {
  validate();

  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
  mkdirp(DIST);
  mkdirp(path.join(DIST, 'assets'));

  // home page
  fs.writeFileSync(path.join(DIST, 'index.html'), indexTemplate());

  // one page per calculator
  for (const calc of calculators) {
    const dir = path.join(DIST, calc.slug);
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), pageTemplate(calc));
  }

  // appliance-specific long-tail pages, e.g. /appliance-electricity-cost-calculator/refrigerator/
  let applianceCombosBuilt = 0;
  for (const calc of calculators) {
    if (!calc.supports_appliance_select) continue;
    for (const appliance of appliances) {
      if (!isUsefulApplianceCombo(calc, appliance)) continue;
      const dir = path.join(DIST, calc.slug, appliance.slug);
      mkdirp(dir);
      fs.writeFileSync(path.join(dir, 'index.html'), pageTemplate(calc, { appliance }));
      applianceCombosBuilt++;
    }
  }

  // battery-spec long-tail pages, e.g. /battery-runtime-calculator/12v-100ah/
  let batterySpecCombosBuilt = 0;
  for (const calc of calculators) {
    if (!calc.supports_battery_spec) continue;
    for (const spec of batterySpecs) {
      if (!isUsefulBatterySpecCombo(calc, spec)) continue;
      const dir = path.join(DIST, calc.slug, spec.slug);
      mkdirp(dir);
      fs.writeFileSync(path.join(dir, 'index.html'), pageTemplate(calc, { batterySpec: spec }));
      batterySpecCombosBuilt++;
    }
  }

  // region x appliance long-tail pages, e.g. /appliance-electricity-cost-calculator/refrigerator/nigeria/
  let regionApplianceCombosBuilt = 0;
  for (const calc of calculators) {
    if (!calcHasCurrencyInput(calc) || !calc.supports_appliance_select) continue;
    for (const appliance of appliances) {
      for (const region of regions) {
        if (!isUsefulRegionApplianceCombo(calc, appliance, region)) continue;
        const dir = path.join(DIST, calc.slug, appliance.slug, region.slug);
        mkdirp(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), pageTemplate(calc, { appliance, region }));
        regionApplianceCombosBuilt++;
      }
    }
  }

  // sitemap + robots
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemapXml());
  fs.writeFileSync(path.join(DIST, 'robots.txt'), robotsTxt());

  // assets: copy formula-core.js so the browser can load it directly,
  // plus the hand-written calculator.js and style.css
  fs.copyFileSync(path.join(ROOT, 'lib/formula-core.js'), path.join(DIST, 'assets/formula-core.js'));
  fs.copyFileSync(path.join(ROOT, 'assets/calculator.js'), path.join(DIST, 'assets/calculator.js'));
  fs.copyFileSync(path.join(ROOT, 'assets/style.css'), path.join(DIST, 'assets/style.css'));

  console.log(`Built ${calculators.length} calculator pages + ${applianceCombosBuilt} appliance pages + ${batterySpecCombosBuilt} battery-spec pages + ${regionApplianceCombosBuilt} region x appliance pages + index + sitemap into /dist`);
}

build();

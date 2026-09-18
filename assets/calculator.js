/**
 * calculator.js — browser-side glue.
 * Loaded after formula-core.js, so `FormulaCore` is available on window.
 * Reads the form built by generate.js's inputsFormHtml(), calls the
 * matching formula, and renders the result — same math as the server used
 * to pre-render the example numbers baked into the page copy.
 */
(function () {
  const form = document.getElementById('calculator-form');
  if (!form) return;

  const resultEl = document.getElementById('result');
  const formulaId = form.getAttribute('data-formula');
  const applianceSelect = document.getElementById('appliance-select');
  const regionSelect = document.getElementById('region-select');
  let currencySymbol = form.getAttribute('data-currency-symbol') || '$';

  // Friendly labels for result keys, since formula-core returns raw field names.
  const LABELS = {
    runtime_hours: 'Runtime', runtime_minutes: 'Runtime (minutes)', usable_energy_wh: 'Usable energy',
    required_capacity_ah: 'Required capacity', required_energy_wh: 'Required energy',
    daily_output_wh: 'Daily output', daily_output_kwh: 'Daily output', monthly_output_kwh: 'Monthly output',
    daily_kwh: 'Daily consumption', daily_cost: 'Daily cost', monthly_cost: 'Monthly cost', annual_cost: 'Annual cost',
    monthly_kwh: 'Monthly consumption', annual_kwh: 'Annual consumption',
    recommended_continuous_watts: 'Recommended continuous rating', recommended_surge_watts: 'Recommended surge rating',
    required_panel_watts: 'Required panel wattage',
    payback_months: 'Payback period (months)', payback_years: 'Payback period (years)',
    recommended_running_watts: 'Recommended running watts', recommended_generator_watts: 'Recommended generator size'
  };

  // Keys whose unit is a currency amount rather than a fixed physical unit —
  // rendered with the selected region's currency symbol instead of a suffix.
  const CURRENCY_KEYS = new Set(['daily_cost', 'monthly_cost', 'annual_cost']);

  const UNITS = {
    runtime_hours: 'hrs', runtime_minutes: 'min', usable_energy_wh: 'Wh',
    required_capacity_ah: 'Ah', required_energy_wh: 'Wh',
    daily_output_wh: 'Wh', daily_output_kwh: 'kWh', monthly_output_kwh: 'kWh',
    daily_kwh: 'kWh', monthly_kwh: 'kWh', annual_kwh: 'kWh',
    recommended_continuous_watts: 'W', recommended_surge_watts: 'W',
    required_panel_watts: 'W', recommended_running_watts: 'W', recommended_generator_watts: 'W'
  };

  function readInputs() {
    const inputs = {};
    form.querySelectorAll('input[type="number"]').forEach(input => {
      inputs[input.name] = parseFloat(input.value);
    });
    return inputs;
  }

  function renderResult(result) {
    const rows = Object.entries(result)
      .filter(([key]) => key !== 'assumptions')
      .map(([key, value]) => {
        const label = LABELS[key] || key;
        const displayValue = CURRENCY_KEYS.has(key) ? `${currencySymbol}${value}` : `${value} ${UNITS[key] || ''}`;
        return `<div class="result-row"><span class="result-label">${label}</span><span class="result-value">${displayValue}</span></div>`;
      }).join('');

    let assumptionsHtml = '';
    if (result.assumptions) {
      const items = Object.entries(result.assumptions).map(([k, v]) => `<li>${k.replace(/_/g, ' ')}: ${v}</li>`).join('');
      assumptionsHtml = `<details class="assumptions"><summary>Assumptions used</summary><ul>${items}</ul></details>`;
    }

    resultEl.innerHTML = `<div class="result-card">${rows}</div>${assumptionsHtml}`;
  }

  function renderError(message) {
    resultEl.innerHTML = `<div class="result-error">${message}</div>`;
  }

  function calculate() {
    const fn = window.FormulaCore && window.FormulaCore[formulaId];
    if (!fn) {
      renderError('This calculator is temporarily unavailable.');
      return;
    }
    try {
      const result = fn(readInputs());
      renderResult(result);
    } catch (err) {
      renderError(err.message);
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    calculate();
  });

  // Live recalculation as the user types, once they've calculated once.
  let hasCalculated = false;
  form.addEventListener('submit', () => { hasCalculated = true; });
  form.addEventListener('input', () => {
    if (hasCalculated) calculate();
  });

  // Appliance dropdown pre-fills watts/hours if the calculator supports it.
  if (applianceSelect) {
    applianceSelect.addEventListener('change', function () {
      const opt = applianceSelect.options[applianceSelect.selectedIndex];
      const watts = opt.getAttribute('data-watts');
      const hours = opt.getAttribute('data-hours');
      const wattsInput = form.querySelector('#watts');
      const hoursInput = form.querySelector('#hours_per_day');
      if (watts && wattsInput) wattsInput.value = watts;
      if (hours && hoursInput) hoursInput.value = hours;
      if (hasCalculated) calculate();
    });
  }

  // Region dropdown updates the electricity rate input and the currency
  // symbol used to render cost results — this is what makes cost pages
  // usable outside the site's default region without generating a
  // separate page per country.
  if (regionSelect) {
    regionSelect.addEventListener('change', function () {
      const opt = regionSelect.options[regionSelect.selectedIndex];
      const rate = opt.getAttribute('data-rate');
      const symbol = opt.getAttribute('data-symbol');
      const rateInput = form.querySelector('#rate_per_kwh');
      if (rate && rateInput) rateInput.value = rate;
      if (symbol) currencySymbol = symbol;
      if (hasCalculated) calculate();
    });
  }

  // Calculate once on load so the page never shows an empty result area.
  calculate();
  hasCalculated = true;
})();

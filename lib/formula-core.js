/**
 * formula-core.js
 * Pure calculation functions — no DOM, no I/O.
 * Used identically at build time (Node, via generate.js) and in the browser
 * (via assets/calculator.js), so there is exactly one place to get the math right.
 *
 * Convention: all functions take a single `inputs` object and return a
 * `result` object with clearly-labeled fields (never a bare number), so the
 * generator and the UI can both render results without guessing what a
 * number means.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(); // Node / build time
  } else {
    root.FormulaCore = factory(); // Browser
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function round(n, decimals) {
    const f = Math.pow(10, decimals == null ? 2 : decimals);
    return Math.round(n * f) / f;
  }

  function assertPositive(value, name) {
    if (value == null || isNaN(value) || value <= 0) {
      throw new Error(`${name} must be a positive number`);
    }
  }

  // ---------------------------------------------------------------------
  // 1. Battery runtime: how long a battery lasts under a given load
  // ---------------------------------------------------------------------
  function batteryRuntime(inputs) {
    const capacityAh = Number(inputs.capacity_ah);
    const voltage = Number(inputs.voltage);
    const loadWatts = Number(inputs.load_watts);
    const dod = inputs.depth_of_discharge != null ? Number(inputs.depth_of_discharge) : 80; // %

    assertPositive(capacityAh, 'capacity_ah');
    assertPositive(voltage, 'voltage');
    assertPositive(loadWatts, 'load_watts');
    if (dod <= 0 || dod > 100) throw new Error('depth_of_discharge must be between 1 and 100');

    const usableWh = capacityAh * voltage * (dod / 100);
    const runtimeHours = usableWh / loadWatts;

    return {
      runtime_hours: round(runtimeHours, 2),
      runtime_minutes: round(runtimeHours * 60, 0),
      usable_energy_wh: round(usableWh, 0),
      assumptions: { depth_of_discharge_pct: dod }
    };
  }

  // ---------------------------------------------------------------------
  // 2. Battery size: what capacity battery is needed for X hours at Y load
  // ---------------------------------------------------------------------
  function batterySize(inputs) {
    const loadWatts = Number(inputs.load_watts);
    const hoursNeeded = Number(inputs.hours_needed);
    const voltage = Number(inputs.voltage);
    const dod = inputs.depth_of_discharge != null ? Number(inputs.depth_of_discharge) : 80;

    assertPositive(loadWatts, 'load_watts');
    assertPositive(hoursNeeded, 'hours_needed');
    assertPositive(voltage, 'voltage');
    if (dod <= 0 || dod > 100) throw new Error('depth_of_discharge must be between 1 and 100');

    const requiredWh = loadWatts * hoursNeeded;
    const requiredAh = requiredWh / (voltage * (dod / 100));

    return {
      required_capacity_ah: round(requiredAh, 1),
      required_energy_wh: round(requiredWh, 0),
      assumptions: { depth_of_discharge_pct: dod }
    };
  }

  // ---------------------------------------------------------------------
  // 3. Solar panel output: expected daily energy from a panel
  // ---------------------------------------------------------------------
  function solarPanelOutput(inputs) {
    const panelWatts = Number(inputs.panel_watts);
    const sunHours = Number(inputs.sun_hours);
    const systemEfficiency = inputs.system_efficiency != null ? Number(inputs.system_efficiency) : 0.75;

    assertPositive(panelWatts, 'panel_watts');
    assertPositive(sunHours, 'sun_hours');
    if (systemEfficiency <= 0 || systemEfficiency > 1) throw new Error('system_efficiency must be between 0 and 1');

    const dailyWh = panelWatts * sunHours * systemEfficiency;

    return {
      daily_output_wh: round(dailyWh, 0),
      daily_output_kwh: round(dailyWh / 1000, 2),
      monthly_output_kwh: round((dailyWh * 30) / 1000, 1),
      assumptions: { system_efficiency: systemEfficiency }
    };
  }

  // ---------------------------------------------------------------------
  // 4. Appliance electricity cost
  // ---------------------------------------------------------------------
  function applianceCost(inputs) {
    const watts = Number(inputs.watts);
    const hoursPerDay = Number(inputs.hours_per_day);
    const ratePerKwh = Number(inputs.rate_per_kwh);

    assertPositive(watts, 'watts');
    assertPositive(hoursPerDay, 'hours_per_day');
    assertPositive(ratePerKwh, 'rate_per_kwh');

    const dailyKwh = (watts * hoursPerDay) / 1000;
    const dailyCost = dailyKwh * ratePerKwh;

    return {
      daily_kwh: round(dailyKwh, 3),
      daily_cost: round(dailyCost, 2),
      monthly_cost: round(dailyCost * 30, 2),
      annual_cost: round(dailyCost * 365, 2)
    };
  }

  // ---------------------------------------------------------------------
  // 5. Power consumption (kWh only, no currency assumption)
  // ---------------------------------------------------------------------
  function powerConsumption(inputs) {
    const watts = Number(inputs.watts);
    const hoursPerDay = Number(inputs.hours_per_day);

    assertPositive(watts, 'watts');
    assertPositive(hoursPerDay, 'hours_per_day');

    const dailyKwh = (watts * hoursPerDay) / 1000;

    return {
      daily_kwh: round(dailyKwh, 3),
      monthly_kwh: round(dailyKwh * 30, 2),
      annual_kwh: round(dailyKwh * 365, 1)
    };
  }

  // ---------------------------------------------------------------------
  // 6. Inverter size
  // ---------------------------------------------------------------------
  function inverterSize(inputs) {
    const totalLoadWatts = Number(inputs.total_load_watts);
    const surgeMultiplier = inputs.surge_multiplier != null ? Number(inputs.surge_multiplier) : 1.5;
    const safetyMargin = inputs.safety_margin != null ? Number(inputs.safety_margin) : 1.2;

    assertPositive(totalLoadWatts, 'total_load_watts');
    assertPositive(surgeMultiplier, 'surge_multiplier');
    assertPositive(safetyMargin, 'safety_margin');

    const continuousRating = totalLoadWatts * safetyMargin;
    const surgeRating = totalLoadWatts * surgeMultiplier;

    return {
      recommended_continuous_watts: round(continuousRating, 0),
      recommended_surge_watts: round(surgeRating, 0),
      assumptions: { surge_multiplier: surgeMultiplier, safety_margin: safetyMargin }
    };
  }

  // ---------------------------------------------------------------------
  // 7. Solar system size (panel wattage needed to meet daily consumption)
  // ---------------------------------------------------------------------
  function solarSystemSize(inputs) {
    const dailyConsumptionWh = Number(inputs.daily_consumption_wh);
    const sunHours = Number(inputs.sun_hours);
    const systemEfficiency = inputs.system_efficiency != null ? Number(inputs.system_efficiency) : 0.75;

    assertPositive(dailyConsumptionWh, 'daily_consumption_wh');
    assertPositive(sunHours, 'sun_hours');
    if (systemEfficiency <= 0 || systemEfficiency > 1) throw new Error('system_efficiency must be between 0 and 1');

    const requiredPanelWatts = dailyConsumptionWh / (sunHours * systemEfficiency);

    return {
      required_panel_watts: round(requiredPanelWatts, 0),
      assumptions: { system_efficiency: systemEfficiency, sun_hours: sunHours }
    };
  }

  // ---------------------------------------------------------------------
  // 8. Solar battery size (energy-based autonomy sizing, distinct from
  //    generic batterySize: driven by daily consumption + days of backup)
  // ---------------------------------------------------------------------
  function solarBatterySize(inputs) {
    const dailyConsumptionWh = Number(inputs.daily_consumption_wh);
    const daysOfAutonomy = Number(inputs.days_of_autonomy);
    const voltage = Number(inputs.voltage);
    const dod = inputs.depth_of_discharge != null ? Number(inputs.depth_of_discharge) : 80;
    const batteryEfficiency = inputs.battery_efficiency != null ? Number(inputs.battery_efficiency) : 0.9;

    assertPositive(dailyConsumptionWh, 'daily_consumption_wh');
    assertPositive(daysOfAutonomy, 'days_of_autonomy');
    assertPositive(voltage, 'voltage');
    if (dod <= 0 || dod > 100) throw new Error('depth_of_discharge must be between 1 and 100');
    if (batteryEfficiency <= 0 || batteryEfficiency > 1) throw new Error('battery_efficiency must be between 0 and 1');

    const requiredWh = (dailyConsumptionWh * daysOfAutonomy) / batteryEfficiency;
    const requiredAh = requiredWh / (voltage * (dod / 100));

    return {
      required_capacity_ah: round(requiredAh, 1),
      required_energy_wh: round(requiredWh, 0),
      assumptions: { depth_of_discharge_pct: dod, battery_efficiency: batteryEfficiency }
    };
  }

  // ---------------------------------------------------------------------
  // 9. Solar payback period
  // ---------------------------------------------------------------------
  function solarPayback(inputs) {
    const systemCost = Number(inputs.system_cost);
    const monthlySavings = Number(inputs.monthly_savings);

    assertPositive(systemCost, 'system_cost');
    assertPositive(monthlySavings, 'monthly_savings');

    const paybackMonths = systemCost / monthlySavings;

    return {
      payback_months: round(paybackMonths, 1),
      payback_years: round(paybackMonths / 12, 2)
    };
  }

  // ---------------------------------------------------------------------
  // 10. Generator size
  // ---------------------------------------------------------------------
  function generatorSize(inputs) {
    const totalLoadWatts = Number(inputs.total_load_watts);
    const startingSurgeWatts = inputs.starting_surge_watts != null
      ? Number(inputs.starting_surge_watts)
      : totalLoadWatts * 1.5; // default assumption if not provided

    assertPositive(totalLoadWatts, 'total_load_watts');
    assertPositive(startingSurgeWatts, 'starting_surge_watts');

    const recommendedWatts = Math.max(totalLoadWatts * 1.25, startingSurgeWatts);

    return {
      recommended_running_watts: round(totalLoadWatts, 0),
      recommended_generator_watts: round(recommendedWatts, 0),
      assumptions: { starting_surge_watts: round(startingSurgeWatts, 0) }
    };
  }

  return {
    round,
    battery_runtime: batteryRuntime,
    battery_size: batterySize,
    solar_panel_output: solarPanelOutput,
    appliance_cost: applianceCost,
    power_consumption: powerConsumption,
    inverter_size: inverterSize,
    solar_system_size: solarSystemSize,
    solar_battery_size: solarBatterySize,
    solar_payback: solarPayback,
    generator_size: generatorSize
  };
});

/**
 * Heat index and rapid pressure-drop helpers for weather overlays.
 */

/** NOAA simplified heat index (°C in/out) when temp ≥ ~27°C and RH ≥ 40%. */
export function heatIndexC(temperatureC: number, relativeHumidityPct: number): number | null {
  if (!Number.isFinite(temperatureC) || !Number.isFinite(relativeHumidityPct)) {
    return null;
  }

  const tempF = (temperatureC * 9) / 5 + 32;
  const rh = relativeHumidityPct;

  if (tempF < 80 || rh < 40) {
    return temperatureC;
  }

  const hi =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;

  return ((hi - 32) * 5) / 9;
}

/** True when 24h mean pressure fell by at least 6 hPa (common trigger threshold). */
export function isRapidPressureDrop(pressureDelta24h: number | null): boolean {
  return pressureDelta24h !== null && pressureDelta24h <= -6;
}

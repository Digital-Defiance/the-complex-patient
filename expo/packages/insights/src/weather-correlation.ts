/**
 * @complex-patient/insights — Weather ↔ symptom correlation detection
 *
 * Pure in-memory analysis pairing daily mean symptom severity with environmental
 * signals (pressure change, humidity, temperature, heat index) at lags 0–3 days.
 */

import type { SymptomEntry } from '@complex-patient/domain';
import type { WeatherTrendDay } from '@complex-patient/weather';
import {
  ANALYSIS_WINDOW_DAYS,
  ANALYSIS_FAILED_MESSAGE,
  type Clock,
} from './types';
import { systemClock } from './pipeline';
import type { AIInsightCard } from './correlation';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_LAG_DAYS = 0;
const MAX_WEATHER_LAG_DAYS = 3;
const MIN_POINTS_PER_CANDIDATE = 5;
const MIN_TRACKING_DAYS = 14;
const MIN_PAIRED_OBSERVATIONS = 10;
const MAX_INSIGHT_CARDS = 10;
export const DEFAULT_WEATHER_SIGNIFICANCE_THRESHOLD = 0.05;

export type WeatherVariable = 'pressureDelta24h' | 'humidity' | 'temperature' | 'heatIndex';

export interface WeatherCorrelationResult {
  symptomVariable: string;
  weatherVariable: WeatherVariable;
  direction: 'positive' | 'negative';
  lagDays: number;
  pValue: number;
}

export type WeatherCorrelationOutcome =
  | {
      status: 'ok';
      cards: AIInsightCard[];
      correlations: WeatherCorrelationResult[];
      durationMs: number;
    }
  | { status: 'no-significant-correlations'; message: string; durationMs: number }
  | {
      status: 'insufficient-data';
      message: string;
      trackingDays: number;
      pairedObservations: number;
    }
  | { status: 'error'; message: string };

export const WEATHER_INSUFFICIENT_HISTORY_MESSAGE =
  'Not enough location-linked history for weather correlations. Enable location when logging (or the mobile location trail) and keep tracking for at least 14 days.';

export const WEATHER_NO_SIGNIFICANT_CORRELATIONS_MESSAGE =
  'Your weather and symptom data were analyzed, but no significant correlations were found.';

const WEATHER_LABELS: Record<WeatherVariable, string> = {
  pressureDelta24h: 'barometric pressure change',
  humidity: 'humidity',
  temperature: 'temperature',
  heatIndex: 'heat index',
};

function dayIndex(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

function windowStart(now: Date): number {
  return now.getTime() - ANALYSIS_WINDOW_DAYS * MS_PER_DAY;
}

function inWindowDay(iso: string, startMs: number, nowMs: number): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t < startMs || t > nowMs) {
    return null;
  }
  return dayIndex(t);
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < MIN_POINTS_PER_CANDIDATE) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) {
    return null;
  }
  const r = cov / Math.sqrt(varX * varY);
  return Math.max(-1, Math.min(1, r));
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

function gammaln(z: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta =
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnBeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betacf(a, b, x)) / a;
  }
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

function correlationPValue(r: number, n: number): number {
  const df = n - 2;
  if (df <= 0) return 1;
  if (Math.abs(r) >= 1) return 0;
  const t2 = (r * r * df) / (1 - r * r);
  return incompleteBeta(df / 2, 0.5, df / (df + t2));
}

type DailySignal = Map<number, number>;

function buildSymptomSignals(
  symptoms: readonly SymptomEntry[],
  startMs: number,
  nowMs: number,
): Map<string, DailySignal> {
  const sums = new Map<string, Map<number, { sum: number; count: number }>>();

  for (const entry of symptoms) {
    const day = inWindowDay(entry.op_timestamp, startMs, nowMs);
    if (day === null) continue;
    let series = sums.get(entry.symptomType);
    if (!series) {
      series = new Map();
      sums.set(entry.symptomType, series);
    }
    const cell = series.get(day) ?? { sum: 0, count: 0 };
    cell.sum += entry.severity;
    cell.count += 1;
    series.set(day, cell);
  }

  const signals = new Map<string, DailySignal>();
  for (const [variable, series] of sums) {
    const daily = new Map<number, number>();
    for (const [day, cell] of series) {
      daily.set(day, cell.sum / cell.count);
    }
    signals.set(variable, daily);
  }
  return signals;
}

function weatherValue(day: WeatherTrendDay, variable: WeatherVariable): number | null {
  switch (variable) {
    case 'pressureDelta24h':
      return day.pressureDelta24h;
    case 'humidity':
      return day.meanHumidityPct;
    case 'temperature':
      return day.meanTemperatureC;
    case 'heatIndex':
      return day.meanHeatIndexC;
    default:
      return null;
  }
}

function buildWeatherSignals(
  weatherDays: readonly WeatherTrendDay[],
  startMs: number,
  nowMs: number,
): Map<WeatherVariable, DailySignal> {
  const signals = new Map<WeatherVariable, DailySignal>();
  const variables: WeatherVariable[] = ['pressureDelta24h', 'humidity', 'temperature', 'heatIndex'];

  for (const variable of variables) {
    signals.set(variable, new Map());
  }

  for (const weatherDay of weatherDays) {
    const dayMs = Date.parse(`${weatherDay.day}T12:00:00Z`);
    if (Number.isNaN(dayMs) || dayMs < startMs || dayMs > nowMs) {
      continue;
    }
    const day = dayIndex(dayMs);
    for (const variable of variables) {
      const value = weatherValue(weatherDay, variable);
      if (value !== null) {
        signals.get(variable)!.set(day, value);
      }
    }
  }

  return signals;
}

function countTrackingDays(
  symptomSignals: Map<string, DailySignal>,
  weatherSignals: Map<WeatherVariable, DailySignal>,
): number {
  const days = new Set<number>();
  for (const signal of symptomSignals.values()) {
    for (const day of signal.keys()) {
      days.add(day);
    }
  }
  for (const signal of weatherSignals.values()) {
    for (const day of signal.keys()) {
      days.add(day);
    }
  }
  return days.size;
}

function countPairedDays(
  symptomSignals: Map<string, DailySignal>,
  weatherSignals: Map<WeatherVariable, DailySignal>,
): number {
  const weatherDays = new Set<number>();
  for (const signal of weatherSignals.values()) {
    for (const day of signal.keys()) {
      weatherDays.add(day);
    }
  }

  const paired = new Set<number>();
  for (const signal of symptomSignals.values()) {
    for (const day of signal.keys()) {
      if (weatherDays.has(day)) {
        paired.add(day);
      }
    }
  }
  return paired.size;
}

function toCard(result: WeatherCorrelationResult): AIInsightCard {
  return {
    variables: [result.symptomVariable, WEATHER_LABELS[result.weatherVariable]],
    direction: result.direction,
    lagDays: result.lagDays,
  };
}

export interface DetectWeatherCorrelationsOptions {
  significanceThreshold?: number;
  clock?: Clock;
}

export function detectWeatherCorrelations(
  symptoms: readonly SymptomEntry[],
  weatherDays: readonly WeatherTrendDay[],
  options: DetectWeatherCorrelationsOptions = {},
): WeatherCorrelationOutcome {
  const started = Date.now();
  const threshold = options.significanceThreshold ?? DEFAULT_WEATHER_SIGNIFICANCE_THRESHOLD;
  const clock = options.clock ?? systemClock;

  try {
    const now = clock.now();
    const nowMs = now.getTime();
    const startMs = windowStart(now);

    const symptomSignals = buildSymptomSignals(symptoms, startMs, nowMs);
    const weatherSignals = buildWeatherSignals(weatherDays, startMs, nowMs);

    const trackingDays = countTrackingDays(symptomSignals, weatherSignals);
    const pairedObservations = countPairedDays(symptomSignals, weatherSignals);

    if (trackingDays < MIN_TRACKING_DAYS || pairedObservations < MIN_PAIRED_OBSERVATIONS) {
      return {
        status: 'insufficient-data',
        message: WEATHER_INSUFFICIENT_HISTORY_MESSAGE,
        trackingDays,
        pairedObservations,
      };
    }

    const candidates: WeatherCorrelationResult[] = [];

    for (const [symptomVariable, symptomSeries] of symptomSignals) {
      for (const [weatherVariable, weatherSeries] of weatherSignals) {
        for (let lag = MIN_LAG_DAYS; lag <= MAX_WEATHER_LAG_DAYS; lag++) {
          const xs: number[] = [];
          const ys: number[] = [];

          for (const [symptomDay, severity] of symptomSeries) {
            const weatherDay = symptomDay - lag;
            const weatherValue = weatherSeries.get(weatherDay);
            if (weatherValue === undefined) {
              continue;
            }
            xs.push(weatherValue);
            ys.push(severity);
          }

          const r = pearson(xs, ys);
          if (r === null) {
            continue;
          }

          const pValue = correlationPValue(r, xs.length);
          if (pValue <= threshold) {
            candidates.push({
              symptomVariable,
              weatherVariable,
              direction: r >= 0 ? 'positive' : 'negative',
              lagDays: lag,
              pValue,
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return {
        status: 'no-significant-correlations',
        message: WEATHER_NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
        durationMs: Date.now() - started,
      };
    }

    candidates.sort((left, right) => left.pValue - right.pValue);
    const top = candidates.slice(0, MAX_INSIGHT_CARDS);

    return {
      status: 'ok',
      cards: top.map(toCard),
      correlations: top,
      durationMs: Date.now() - started,
    };
  } catch {
    return { status: 'error', message: ANALYSIS_FAILED_MESSAGE };
  }
}

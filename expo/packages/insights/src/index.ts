/**
 * @complex-patient/insights
 *
 * Sandboxed analytics and PDF report generation.
 * All computations run on-device; no raw data leaves this module.
 */

export type {
  MedEvent,
  AnalysisInput,
  VaultDataSource,
  Clock,
  VarianceAnalysis,
  AnalysisResult,
} from './types';

export {
  INSUFFICIENT_DATA_MESSAGE,
  ANALYSIS_FAILED_MESSAGE,
  ANALYSIS_WINDOW_DAYS,
} from './types';

export { runAnalysis, systemClock } from './pipeline';

export { createInMemoryVaultDataSource } from './data-source';

export type {
  CorrelationResult,
  AIInsightCard,
  CorrelationOutcome,
  DetectCorrelationsOptions,
} from './correlation';

export {
  detectCorrelations,
  MIN_LAG_DAYS,
  MAX_LAG_DAYS,
  DEFAULT_SIGNIFICANCE_THRESHOLD,
  MAX_INSIGHT_CARDS,
  MIN_TRACKING_DAYS,
  MIN_PAIRED_OBSERVATIONS,
  INSUFFICIENT_HISTORY_MESSAGE,
  NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
} from './correlation';

export type {
  WeatherCorrelationOutcome,
  WeatherCorrelationResult,
  WeatherVariable,
  DetectWeatherCorrelationsOptions,
} from './weather-correlation';

export {
  detectWeatherCorrelations,
  DEFAULT_WEATHER_SIGNIFICANCE_THRESHOLD,
  WEATHER_INSUFFICIENT_HISTORY_MESSAGE,
  WEATHER_NO_SIGNIFICANT_CORRELATIONS_MESSAGE,
} from './weather-correlation';

export type {
  ReportDataSource,
  PhysicianReport,
  PhysicianReportSection,
  PhysicianReportRenderer,
  PhysicianReportBuildResult,
  PhysicianReportResult,
} from './report';

export {
  buildPhysicianReport,
  generatePhysicianReport,
  createInMemoryReportDataSource,
  REPORT_WINDOW_DAYS,
  SEVERE_SYMPTOM_THRESHOLD,
  REPORT_TIME_BUDGET_MS,
  NO_DATA_AVAILABLE_MESSAGE,
  REPORT_FAILED_MESSAGE,
  REPORT_SECTION_TITLES,
} from './report';

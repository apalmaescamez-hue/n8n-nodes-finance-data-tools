import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';

export type Severity = NodeSeverity;

export type PredictiveAnalyticsOperation =
  | 'cagr_forecast'
  | 'moving_average_forecast'
  | 'simple_linear_regression'
  | 'trend_forecast';

export type DecimalInput = string | number | bigint;

export interface PredictiveAnalyticsOptions {
  operation: PredictiveAnalyticsOperation;
  valueColumn?: string;
  xColumn?: string;
  horizon?: number;
  windowSize?: number;
  periodsPerYear?: number;
  maxHorizon?: number;
  currency?: string;
}

export type PredictiveAnalyticsWarning = NodeWarning;

export type PredictiveAnalyticsError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type PredictiveAnalyticsMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, PredictiveAnalyticsMetadata>;

export interface ForecastPoint {
  step: number;
  forecast: string;
  lowerBound?: string;
  upperBound?: string;
  method: PredictiveAnalyticsOperation;
}

export interface RegressionModel {
  slope: string;
  intercept: string;
  rSquared: string | null;
  observationCount: number;
  xColumn?: string;
  yColumn: string;
}

export interface EvaluationMetrics {
  mae: string | null;
  mse: string | null;
  rmse: string | null;
  mape: string | null;
  zeroActualCount: number;
}

export interface PredictiveAnalyticsData {
  operation: PredictiveAnalyticsOperation;
  valueColumn: string;
  xColumn?: string;
  currency: string | null;
  model?: RegressionModel;
  forecast: ForecastPoint[];
  metrics: EvaluationMetrics;
  summary: string;
  limitations: string[];
  inputSummary: {
    rowCount: number;
    validObservationCount: number;
    ignoredObservationCount: number;
    horizon: number;
  };
}

import Decimal from 'decimal.js';
import { z } from 'zod';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AuditTrailEntry,
  EvaluationMetrics,
  ForecastPoint,
  PredictiveAnalyticsData,
  PredictiveAnalyticsError,
  PredictiveAnalyticsOperation,
  PredictiveAnalyticsOptions,
  PredictiveAnalyticsWarning,
  RegressionModel,
  ToolEnvelope,
} from './types';

const inputSchema = z.array(z.record(z.string(), z.unknown()));
const SUPPORTED_OPERATIONS: readonly PredictiveAnalyticsOperation[] = [
  'cagr_forecast',
  'moving_average_forecast',
  'simple_linear_regression',
  'trend_forecast',
];
const DIRECTIONAL_LIMITATION = 'This prediction is directional and should not be interpreted as certainty.';
const DEFAULT_MAX_HORIZON = 24;

interface RuntimeState {
  warnings: PredictiveAnalyticsWarning[];
  warningKeys: Set<string>;
}

interface Observation {
  rowIndex: number;
  x: Decimal;
  y: Decimal;
}

interface ObservationCollection {
  observations: Observation[];
  missingCount: number;
  nonNumericCount: number;
  ignoredCount: number;
}

interface ParsedDecimalValue {
  parsed: boolean;
  value: Decimal | null;
}

interface RegressionFit {
  slope: Decimal;
  intercept: Decimal;
  rSquared: Decimal | null;
  fittedValues: Decimal[];
}

export function runPredictiveAnalytics(
  input: unknown,
  options: PredictiveAnalyticsOptions,
): ToolEnvelope<PredictiveAnalyticsData> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const operation = isPredictiveAnalyticsOperation(options.operation)
    ? options.operation
    : 'moving_average_forecast';
  const warnings: PredictiveAnalyticsWarning[] = [];
  const errors: PredictiveAnalyticsError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_validation',
      message: 'Predictive analytics input received.',
      details: {
        requestedOperation: options.operation,
      },
    }),
  ];

  if (!isPredictiveAnalyticsOperation(options.operation)) {
    errors.push({
      code: 'UNSUPPORTED_OPERATION',
      severity: 'error',
      message: `Unsupported predictive analytics operation: ${String(options.operation)}`,
      details: {
        supportedOperations: SUPPORTED_OPERATIONS,
      },
    });

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      warnings,
      errors,
      auditTrail,
      failureMessage: 'Predictive analytics operation rejected.',
    });
  }

  const parsed = inputSchema.safeParse(input);

  if (!parsed.success) {
    errors.push({
      code: 'INVALID_INPUT',
      severity: 'error',
      message: 'Expected an array of JSON objects, where each object is one time-series row.',
      details: {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    });

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      warnings,
      errors,
      auditTrail,
      failureMessage: 'Predictive analytics input validation failed.',
    });
  }

  const rows = parsed.data;
  const columnNames = getColumnNames(rows);
  const valueColumn = cleanColumnName(options.valueColumn);
  const xColumn = cleanColumnName(options.xColumn);
  const horizon = resolvePositiveInteger(options.horizon, 3);
  const maxHorizon = resolvePositiveInteger(options.maxHorizon, DEFAULT_MAX_HORIZON);
  const runtime: RuntimeState = { warnings, warningKeys: new Set<string>() };

  auditTrail.push(createAuditTrailEvent({
    step: 'input_validation',
    message: 'Predictive analytics input shape was validated.',
    details: {
      rowCount: rows.length,
      columnCount: columnNames.length,
      operation,
    },
  }));

  validateCommonOptions({
    operation,
    valueColumn,
    xColumn,
    horizon,
    maxHorizon,
    columnNames: new Set(columnNames),
    errors,
    warnings,
  });

  auditTrail.push(createAuditTrailEvent({
    step: 'parameter_validation',
    message: errors.length === 0 ? 'Predictive analytics parameters were validated.' : 'Predictive analytics parameter validation failed.',
    details: {
      valueColumn,
      xColumn: xColumn || null,
      horizon,
      maxHorizon,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  }));

  if (errors.length > 0) {
    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: rows.length,
      columnCount: columnNames.length,
      warnings,
      errors,
      auditTrail,
      failureMessage: 'Predictive analytics parameter validation failed.',
    });
  }

  const collection = collectObservations(rows, valueColumn, operation === 'simple_linear_regression' ? xColumn : '', runtime);
  addObservationWarnings(collection, runtime, valueColumn);
  addReliabilityWarnings(collection.observations, horizon, runtime);

  auditTrail.push(createAuditTrailEvent({
    step: 'series_preparation',
    message: 'Predictive analytics observations were prepared.',
    details: {
      validObservationCount: collection.observations.length,
      ignoredObservationCount: collection.ignoredCount,
      missingCount: collection.missingCount,
      nonNumericCount: collection.nonNumericCount,
    },
  }));

  const minimumObservations = operation === 'moving_average_forecast' ? 1 : 2;

  if (collection.observations.length < minimumObservations) {
    errors.push({
      code: 'INSUFFICIENT_OBSERVATIONS',
      severity: 'error',
      message: `Operation "${operation}" requires at least ${minimumObservations} valid observations.`,
      details: {
        validObservationCount: collection.observations.length,
        minimumObservations,
      },
    });

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: rows.length,
      columnCount: columnNames.length,
      warnings,
      errors,
      auditTrail,
      failureMessage: 'Predictive analytics series preparation failed.',
    });
  }

  const outcome = calculateOutcome({
    operation,
    observations: collection.observations,
    horizon,
    windowSize: resolvePositiveInteger(options.windowSize, 3),
    periodsPerYear: resolvePositiveInteger(options.periodsPerYear, 12),
    valueColumn,
    xColumn: xColumn || undefined,
    runtime,
  });

  if (outcome.errors.length > 0) {
    errors.push(...outcome.errors);

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: rows.length,
      columnCount: columnNames.length,
      warnings,
      errors,
      auditTrail,
      failureMessage: 'Predictive analytics calculation failed.',
    });
  }

  auditTrail.push(createAuditTrailEvent({
    step: 'model_calculation',
    message: 'Predictive analytics model was calculated.',
    details: {
      operation,
      forecastCount: outcome.forecast.length,
      modelIncluded: outcome.model !== undefined,
    },
  }));

  auditTrail.push(createAuditTrailEvent({
    step: 'forecast_generation',
    message: 'Predictive analytics forecast was generated.',
    details: {
      horizon,
      warningCount: warnings.length,
    },
  }));

  const data: PredictiveAnalyticsData = {
    operation,
    valueColumn,
    xColumn: xColumn || undefined,
    currency: cleanCurrency(options.currency),
    model: outcome.model,
    forecast: outcome.forecast,
    metrics: outcome.metrics,
    summary: buildSummary(operation, outcome.forecast, valueColumn),
    limitations: buildLimitations(operation),
    inputSummary: {
      rowCount: rows.length,
      validObservationCount: collection.observations.length,
      ignoredObservationCount: collection.ignoredCount,
      horizon,
    },
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'operation_completed',
    message: 'Predictive analytics operation completed successfully.',
    details: {
      operation,
      warningCount: warnings.length,
      errorCount: errors.length,
    },
  }));

  return createSuccessOutput({
    operation,
    data,
    metadata: {
      rowCount: rows.length,
      columnCount: columnNames.length,
      generatedAt,
      startedAt,
    },
    warnings,
    errors,
    auditTrail,
  });
}
function calculateOutcome({
  operation,
  observations,
  horizon,
  windowSize,
  periodsPerYear,
  valueColumn,
  xColumn,
  runtime,
}: {
  operation: PredictiveAnalyticsOperation;
  observations: Observation[];
  horizon: number;
  windowSize: number;
  periodsPerYear: number;
  valueColumn: string;
  xColumn?: string;
  runtime: RuntimeState;
}): {
  errors: PredictiveAnalyticsError[];
  forecast: ForecastPoint[];
  metrics: EvaluationMetrics;
  model?: RegressionModel;
} {
  switch (operation) {
    case 'moving_average_forecast':
      return calculateMovingAverageForecast(observations, horizon, windowSize, runtime);
    case 'cagr_forecast':
      return calculateCagrForecast(observations, horizon, periodsPerYear);
    case 'trend_forecast':
      return calculateTrendForecast(observations, horizon, valueColumn);
    case 'simple_linear_regression':
      return calculateSimpleLinearRegressionForecast(observations, horizon, valueColumn, xColumn ?? 'x');
  }
}

function calculateMovingAverageForecast(
  observations: Observation[],
  horizon: number,
  windowSize: number,
  runtime: RuntimeState,
): { errors: PredictiveAnalyticsError[]; forecast: ForecastPoint[]; metrics: EvaluationMetrics } {
  const errors: PredictiveAnalyticsError[] = [];
  const effectiveWindow = Math.min(windowSize, observations.length);

  if (windowSize > observations.length) {
    addWarningOnce(runtime, 'WINDOW_SIZE_EXCEEDS_OBSERVATIONS', {
      code: 'WINDOW_SIZE_EXCEEDS_OBSERVATIONS',
      severity: 'warning',
      message: 'Moving average window is larger than the available observations. The full series was used instead.',
      details: { requestedWindowSize: windowSize, effectiveWindow },
    });
  }

  const values = observations.map((observation) => observation.y);
  const history = [...values];
  const forecast: ForecastPoint[] = [];

  for (let step = 1; step <= horizon; step += 1) {
    const windowValues = history.slice(-effectiveWindow);
    const average = averageDecimals(windowValues);
    forecast.push({ step, forecast: formatDecimal(average), method: 'moving_average_forecast' });
    history.push(average);
  }

  return { errors, forecast, metrics: calculateMetrics(values.slice(effectiveWindow), calculateRollingFittedValues(values, effectiveWindow).slice(effectiveWindow)) };
}

function calculateCagrForecast(
  observations: Observation[],
  horizon: number,
  periodsPerYear: number,
): { errors: PredictiveAnalyticsError[]; forecast: ForecastPoint[]; metrics: EvaluationMetrics; model: RegressionModel } {
  const errors: PredictiveAnalyticsError[] = [];
  const first = observations[0].y;
  const last = observations[observations.length - 1].y;
  const periods = new Decimal(observations.length - 1).div(periodsPerYear);

  if (first.lte(0) || last.lte(0) || periods.lte(0)) {
    errors.push({
      code: 'INVALID_CAGR_SERIES',
      severity: 'error',
      message: 'CAGR forecast requires positive first and last values and at least two periods.',
      details: { firstValue: formatDecimal(first), lastValue: formatDecimal(last), periods: formatDecimal(periods) },
    });
    return { errors, forecast: [], metrics: emptyMetrics(), model: createEmptyModel('value') };
  }

  const cagr = decimalPow(last.div(first), new Decimal(1).div(periods)).minus(1);
  const periodGrowth = decimalPow(new Decimal(1).plus(cagr), new Decimal(1).div(periodsPerYear)).minus(1);
  const forecast: ForecastPoint[] = [];
  let previous = last;

  for (let step = 1; step <= horizon; step += 1) {
    previous = previous.mul(new Decimal(1).plus(periodGrowth));
    forecast.push({ step, forecast: formatDecimal(previous), method: 'cagr_forecast' });
  }

  return {
    errors,
    forecast,
    metrics: emptyMetrics(),
    model: {
      slope: formatDecimal(periodGrowth),
      intercept: formatDecimal(first),
      rSquared: null,
      observationCount: observations.length,
      yColumn: 'value',
    },
  };
}

function calculateTrendForecast(
  observations: Observation[],
  horizon: number,
  valueColumn: string,
): { errors: PredictiveAnalyticsError[]; forecast: ForecastPoint[]; metrics: EvaluationMetrics; model: RegressionModel } {
  return calculateSimpleLinearRegressionForecast(
    observations.map((observation, index) => ({ ...observation, x: new Decimal(index + 1) })),
    horizon,
    valueColumn,
    'periodIndex',
    'trend_forecast',
  );
}

function calculateSimpleLinearRegressionForecast(
  observations: Observation[],
  horizon: number,
  valueColumn: string,
  xColumn: string,
  method: PredictiveAnalyticsOperation = 'simple_linear_regression',
): { errors: PredictiveAnalyticsError[]; forecast: ForecastPoint[]; metrics: EvaluationMetrics; model: RegressionModel } {
  const fit = fitSimpleLinearRegression(observations);
  const lastX = observations[observations.length - 1].x;
  const stepSize = inferStepSize(observations);
  const forecast: ForecastPoint[] = [];

  for (let step = 1; step <= horizon; step += 1) {
    const futureX = lastX.plus(stepSize.mul(step));
    const predicted = fit.slope.mul(futureX).plus(fit.intercept);
    forecast.push({ step, forecast: formatDecimal(predicted), method });
  }

  return {
    errors: [],
    forecast,
    metrics: calculateMetrics(observations.map((observation) => observation.y), fit.fittedValues),
    model: {
      slope: formatDecimal(fit.slope),
      intercept: formatDecimal(fit.intercept),
      rSquared: fit.rSquared === null ? null : formatDecimal(fit.rSquared),
      observationCount: observations.length,
      xColumn,
      yColumn: valueColumn,
    },
  };
}

function fitSimpleLinearRegression(observations: Observation[]): RegressionFit {
  const n = new Decimal(observations.length);
  const sumX = observations.reduce((total, observation) => total.plus(observation.x), new Decimal(0));
  const sumY = observations.reduce((total, observation) => total.plus(observation.y), new Decimal(0));
  const meanX = sumX.div(n);
  const meanY = sumY.div(n);
  const numerator = observations.reduce(
    (total, observation) => total.plus(observation.x.minus(meanX).mul(observation.y.minus(meanY))),
    new Decimal(0),
  );
  const denominator = observations.reduce(
    (total, observation) => total.plus(observation.x.minus(meanX).pow(2)),
    new Decimal(0),
  );
  const slope = denominator.isZero() ? new Decimal(0) : numerator.div(denominator);
  const intercept = meanY.minus(slope.mul(meanX));
  const fittedValues = observations.map((observation) => slope.mul(observation.x).plus(intercept));
  const ssTotal = observations.reduce((total, observation) => total.plus(observation.y.minus(meanY).pow(2)), new Decimal(0));
  const ssResidual = observations.reduce((total, observation, index) => total.plus(observation.y.minus(fittedValues[index]).pow(2)), new Decimal(0));
  const rSquared = ssTotal.isZero() ? null : new Decimal(1).minus(ssResidual.div(ssTotal));

  return { slope, intercept, rSquared, fittedValues };
}
function validateCommonOptions({
  operation,
  valueColumn,
  xColumn,
  horizon,
  maxHorizon,
  columnNames,
  errors,
  warnings,
}: {
  operation: PredictiveAnalyticsOperation;
  valueColumn: string;
  xColumn: string;
  horizon: number;
  maxHorizon: number;
  columnNames: Set<string>;
  errors: PredictiveAnalyticsError[];
  warnings: PredictiveAnalyticsWarning[];
}): void {
  if (!valueColumn) {
    errors.push({ code: 'MISSING_VALUE_COLUMN', severity: 'error', message: 'Value Column is required.', field: 'valueColumn' });
  } else if (!columnNames.has(valueColumn)) {
    errors.push({ code: 'COLUMN_NOT_FOUND', severity: 'error', message: `Value column "${valueColumn}" does not exist in the input rows.`, field: valueColumn });
  }

  if (operation === 'simple_linear_regression') {
    if (!xColumn) {
      errors.push({ code: 'MISSING_X_COLUMN', severity: 'error', message: 'X Column is required for simple linear regression.', field: 'xColumn' });
    } else if (!columnNames.has(xColumn)) {
      errors.push({ code: 'COLUMN_NOT_FOUND', severity: 'error', message: `X column "${xColumn}" does not exist in the input rows.`, field: xColumn });
    }
  }

  if (horizon < 1) {
    errors.push({ code: 'INVALID_HORIZON', severity: 'error', message: 'Forecast horizon must be at least 1.', field: 'horizon' });
  }

  if (horizon > maxHorizon) {
    warnings.push({
      code: 'FORECAST_HORIZON_HIGH',
      severity: 'warning',
      message: 'Forecast horizon exceeds the configured recommended maximum.',
      field: 'horizon',
      details: { horizon, maxHorizon },
    });
  }
}

function collectObservations(
  rows: Array<Record<string, unknown>>,
  valueColumn: string,
  xColumn: string,
  runtime: RuntimeState,
): ObservationCollection {
  const observations: Observation[] = [];
  let missingCount = 0;
  let nonNumericCount = 0;

  rows.forEach((row, rowIndex) => {
    const rawY = row[valueColumn];

    if (isMissingValue(rawY)) {
      missingCount += 1;
      return;
    }

    const y = parseDecimalValue(rawY, runtime, valueColumn);
    const x = xColumn ? parseDecimalValue(row[xColumn], runtime, xColumn) : { parsed: true, value: new Decimal(rowIndex + 1) };

    if (!y.parsed || y.value === null || !x.parsed || x.value === null) {
      nonNumericCount += 1;
      return;
    }

    observations.push({ rowIndex, x: x.value, y: y.value });
  });

  return { observations, missingCount, nonNumericCount, ignoredCount: rows.length - observations.length };
}

function addObservationWarnings(collection: ObservationCollection, runtime: RuntimeState, valueColumn: string): void {
  if (collection.nonNumericCount > 0) {
    addWarningOnce(runtime, 'NON_NUMERIC_VALUES_IGNORED', {
      code: 'NON_NUMERIC_VALUES_IGNORED',
      severity: 'warning',
      message: `Non-numeric values in the predictive series were ignored.`,
      field: valueColumn,
      details: { nonNumericCount: collection.nonNumericCount, missingCount: collection.missingCount },
    });
  }

  if (collection.missingCount > 0) {
    addWarningOnce(runtime, 'MISSING_VALUES_IGNORED', {
      code: 'MISSING_VALUES_IGNORED',
      severity: 'warning',
      message: `Missing values in column "${valueColumn}" were ignored.`,
      field: valueColumn,
      details: { missingCount: collection.missingCount },
    });
  }
}

function addReliabilityWarnings(observations: Observation[], horizon: number, runtime: RuntimeState): void {
  if (observations.length < 6) {
    addWarningOnce(runtime, 'SMALL_SAMPLE_SIZE', {
      code: 'SMALL_SAMPLE_SIZE',
      severity: 'warning',
      message: 'Forecast uses a small sample. Treat results as directional only.',
      details: { validObservationCount: observations.length },
    });
  }

  if (horizon > observations.length) {
    addWarningOnce(runtime, 'HORIZON_EXCEEDS_HISTORY', {
      code: 'HORIZON_EXCEEDS_HISTORY',
      severity: 'warning',
      message: 'Forecast horizon is longer than the available history.',
      details: { horizon, validObservationCount: observations.length },
    });
  }

  if (countIqrOutliers(observations.map((observation) => observation.y)) > 0) {
    addWarningOnce(runtime, 'OUTLIERS_DETECTED', {
      code: 'OUTLIERS_DETECTED',
      severity: 'warning',
      message: 'Potential outliers were detected in the predictive series.',
    });
  }
}

function calculateMetrics(actual: Decimal[], predicted: Decimal[]): EvaluationMetrics {
  if (actual.length === 0 || predicted.length === 0 || actual.length !== predicted.length) {
    return emptyMetrics();
  }

  const errors = actual.map((value, index) => value.minus(predicted[index]));
  const absoluteErrors = errors.map((error) => error.abs());
  const squaredErrors = errors.map((error) => error.pow(2));
  const nonZeroActuals = actual.filter((value) => !value.isZero());
  const zeroActualCount = actual.length - nonZeroActuals.length;
  const mae = averageDecimals(absoluteErrors);
  const mse = averageDecimals(squaredErrors);
  const rmse = decimalSqrt(mse);
  const mape = nonZeroActuals.length === 0
    ? null
    : averageDecimals(actual
      .map((value, index) => (value.isZero() ? null : actual[index].minus(predicted[index]).abs().div(value.abs())))
      .filter((value): value is Decimal => value !== null))
      .mul(100);

  return {
    mae: formatDecimal(mae),
    mse: formatDecimal(mse),
    rmse: formatDecimal(rmse),
    mape: mape === null ? null : formatDecimal(mape),
    zeroActualCount,
  };
}

function calculateRollingFittedValues(values: Decimal[], windowSize: number): Decimal[] {
  return values.map((value, index) => {
    if (index < windowSize) return value;
    return averageDecimals(values.slice(index - windowSize, index));
  });
}

function inferStepSize(observations: Observation[]): Decimal {
  if (observations.length < 2) return new Decimal(1);
  const differences: Decimal[] = [];
  for (let index = 1; index < observations.length; index += 1) {
    differences.push(observations[index].x.minus(observations[index - 1].x));
  }
  const average = averageDecimals(differences);
  return average.isZero() ? new Decimal(1) : average;
}
function createFailureEnvelope({
  operation,
  generatedAt,
  startedAt,
  rowCount,
  columnCount,
  warnings,
  errors,
  auditTrail,
  failureMessage,
}: {
  operation: PredictiveAnalyticsOperation;
  generatedAt: string;
  startedAt: number;
  rowCount: number;
  columnCount: number;
  warnings: PredictiveAnalyticsWarning[];
  errors: PredictiveAnalyticsError[];
  auditTrail: AuditTrailEntry[];
  failureMessage: string;
}): ToolEnvelope<PredictiveAnalyticsData> {
  return createFailureOutput<PredictiveAnalyticsData>({
    operation,
    data: null,
    metadata: { rowCount, columnCount, generatedAt, startedAt },
    warnings,
    errors,
    auditTrail: [
      ...auditTrail,
      createAuditTrailEvent({
        step: 'operation_completed',
        message: failureMessage,
        details: { errorCount: errors.length, warningCount: warnings.length },
      }),
    ],
  });
}

function emptyMetrics(): EvaluationMetrics {
  return { mae: null, mse: null, rmse: null, mape: null, zeroActualCount: 0 };
}

function createEmptyModel(yColumn: string): RegressionModel {
  return { slope: '0', intercept: '0', rSquared: null, observationCount: 0, yColumn };
}

function buildSummary(operation: PredictiveAnalyticsOperation, forecast: ForecastPoint[], valueColumn: string): string {
  const firstForecast = forecast[0]?.forecast ?? 'n/a';
  const lastForecast = forecast[forecast.length - 1]?.forecast ?? 'n/a';
  return `Generated ${forecast.length} ${operation} forecast point(s) for "${valueColumn}". First forecast: ${firstForecast}. Last forecast: ${lastForecast}.`;
}

function buildLimitations(operation: PredictiveAnalyticsOperation): string[] {
  return [
    DIRECTIONAL_LIMITATION,
    'Forecasts are deterministic and based only on the provided historical JSON rows.',
    operation === 'simple_linear_regression' || operation === 'trend_forecast'
      ? 'Linear trend does not prove causality and can be misleading with non-linear or seasonal data.'
      : 'Moving-average and CAGR forecasts smooth history and can miss abrupt business changes.',
  ];
}

function parseDecimalValue(value: unknown, runtime: RuntimeState, field: string): ParsedDecimalValue {
  if (value instanceof Decimal) return { parsed: value.isFinite(), value: value.isFinite() ? value : null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { parsed: false, value: null };
    addWarningOnce(runtime, `NUMERIC_INPUT_AS_NUMBER:${field}`, {
      code: 'NUMERIC_INPUT_AS_NUMBER',
      severity: 'info',
      message: 'A predictive numeric input arrived as JavaScript number; source precision may already be limited before decimal.js processing.',
      field,
    });
    return { parsed: true, value: new Decimal(value.toString()) };
  }
  if (typeof value === 'bigint') return { parsed: true, value: new Decimal(value.toString()) };
  if (typeof value !== 'string') return { parsed: false, value: null };

  const trimmed = value.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return { parsed: false, value: null };

  try {
    const decimal = new Decimal(trimmed);
    return { parsed: decimal.isFinite(), value: decimal.isFinite() ? decimal : null };
  } catch {
    return { parsed: false, value: null };
  }
}

function decimalPow(base: Decimal, exponent: Decimal): Decimal {
  return new Decimal(Math.pow(base.toNumber(), exponent.toNumber()).toString());
}

function decimalSqrt(value: Decimal): Decimal {
  return new Decimal(Math.sqrt(value.toNumber()).toString());
}

function averageDecimals(values: Decimal[]): Decimal {
  if (values.length === 0) return new Decimal(0);
  return values.reduce((total, value) => total.plus(value), new Decimal(0)).div(values.length);
}

function countIqrOutliers(values: Decimal[]): number {
  if (values.length < 4) return 0;
  const sorted = [...values].sort((left, right) => left.comparedTo(right));
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  const iqr = q3.minus(q1);
  const lowerFence = q1.minus(iqr.mul(1.5));
  const upperFence = q3.plus(iqr.mul(1.5));
  return values.filter((value) => value.lt(lowerFence) || value.gt(upperFence)).length;
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function cleanColumnName(value: string | undefined): string {
  return (value ?? '').trim();
}

function cleanCurrency(value: string | undefined): string | null {
  const cleaned = (value ?? '').trim().toUpperCase();
  return cleaned ? cleaned : null;
}

function getColumnNames(rows: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) names.add(key);
  return [...names];
}

function isMissingValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function isPredictiveAnalyticsOperation(value: unknown): value is PredictiveAnalyticsOperation {
  return typeof value === 'string' && SUPPORTED_OPERATIONS.includes(value as PredictiveAnalyticsOperation);
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

function addWarningOnce(runtime: RuntimeState, key: string, warning: PredictiveAnalyticsWarning): void {
  if (runtime.warningKeys.has(key)) return;
  runtime.warningKeys.add(key);
  runtime.warnings.push(warning);
}

import Decimal from 'decimal.js';

import { cleanDataset } from '../../data/cleaning';
import type { CleanDatasetOptions } from '../../data/cleaning';
import { normalizeDataset } from '../../data/normalization';
import type { NormalizeDatasetOptions } from '../../data/normalization';
import { profileDataset } from '../../data/profiling';
import type { ProfileDatasetOptions } from '../../data/profiling';
import { validateJournalEntries } from '../../accounting';
import type { AccountingValidationOptions } from '../../accounting';
import { calculateFinancialRatios } from '../../finance/ratios';
import type { CalculateFinancialRatiosOptions } from '../../finance/ratios';
import { buildFinancialReport } from '../../finance/reports';
import type { BuildFinancialReportOptions } from '../../finance/reports';
import { calculateStatistics } from '../../math/statistics';
import type { CalculateStatisticsOptions } from '../../math/statistics';
import { runPredictiveAnalytics } from '../../ml/forecasting';
import type { PredictiveAnalyticsOptions } from '../../ml/forecasting';
import {
  createAuditTrailEvent,
  createFailureOutput,
  createSuccessOutput,
} from '../../../shared';
import type { StandardNodeOutput } from '../../../shared';
import type {
  AgentInstructions,
  AiFinanceToolData,
  AiFinanceToolError,
  AiFinanceToolOperation,
  AiFinanceToolOptions,
  AiFinanceToolWarning,
  AuditTrailEntry,
  PredictionEvaluationData,
  ToolEnvelope,
} from './types';

const SUPPORTED_AI_FINANCE_TOOL_OPERATIONS: readonly AiFinanceToolOperation[] = [
  'build_financial_report',
  'calculate_financial_ratios',
  'calculate_statistics',
  'clean_data',
  'evaluate_prediction_model',
  'forecast_financial_metric',
  'normalize_data',
  'profile_data',
  'train_simple_regression',
  'validate_accounting_entries',
];
const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_FORECAST_HORIZON = 12;
const PREDICTIVE_OPERATIONS = new Set<AiFinanceToolOperation>([
  'evaluate_prediction_model',
  'forecast_financial_metric',
  'train_simple_regression',
]);

interface ResolvedControls {
  allowPredictiveOperations: boolean;
  maxForecastHorizon: number;
  maxRows: number;
  rowCount: number;
}

interface ParsedDecimalValue {
  parsed: boolean;
  value: Decimal | null;
}

export function runAiFinanceTool(
  input: unknown,
  options: AiFinanceToolOptions,
): ToolEnvelope<AiFinanceToolData> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const warnings: AiFinanceToolWarning[] = [];
  const errors: AiFinanceToolError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'operation_allowlist_validation',
      message: 'AI Finance Tool request received.',
      details: {
        requestedOperation: options.operation,
      },
    }),
  ];

  if (!isAiFinanceToolOperation(options.operation)) {
    errors.push({
      code: 'UNSUPPORTED_AI_TOOL_OPERATION',
      severity: 'error',
      message: `Unsupported AI Finance Tool operation: ${String(options.operation)}`,
      details: {
        supportedOperations: SUPPORTED_AI_FINANCE_TOOL_OPERATIONS,
      },
    });

    return createAiFailure({
      operation: String(options.operation),
      generatedAt,
      startedAt,
      rowCount: 0,
      warnings,
      errors,
      auditTrail,
      message: 'AI Finance Tool operation failed allowlist validation.',
    });
  }

  const rowCount = countRows(input);
  const controls = resolveControls(options, rowCount);

  if (rowCount > controls.maxRows) {
    errors.push({
      code: 'MAX_ROWS_EXCEEDED',
      severity: 'error',
      message: 'Input exceeds the configured maximum row count for AI Finance Tool.',
      details: {
        rowCount,
        maxRows: controls.maxRows,
      },
    });
  }

  if (PREDICTIVE_OPERATIONS.has(options.operation) && !controls.allowPredictiveOperations) {
    errors.push({
      code: 'PREDICTIVE_OPERATION_NOT_ALLOWED',
      severity: 'error',
      message: 'Predictive operations are disabled by default. Enable allowPredictiveOperations explicitly.',
      field: 'allowPredictiveOperations',
    });
  }

  if (PREDICTIVE_OPERATIONS.has(options.operation) && controls.maxForecastHorizon < resolveForecastHorizon(options)) {
    errors.push({
      code: 'FORECAST_HORIZON_LIMIT_EXCEEDED',
      severity: 'error',
      message: 'Requested forecast horizon exceeds the AI Finance Tool maximum horizon.',
      field: 'forecastHorizon',
      details: {
        forecastHorizon: resolveForecastHorizon(options),
        maxForecastHorizon: controls.maxForecastHorizon,
      },
    });
  }

  auditTrail.push(createAuditTrailEvent({
    step: 'safety_controls_validation',
    message: errors.length === 0 ? 'AI Finance Tool safety controls passed.' : 'AI Finance Tool safety controls failed.',
    details: {
      controls,
      errorCount: errors.length,
    },
  }));

  if (errors.length > 0) {
    return createAiFailure({
      operation: options.operation,
      generatedAt,
      startedAt,
      rowCount,
      warnings,
      errors,
      auditTrail,
      message: 'AI Finance Tool safety validation failed.',
    });
  }

  const childEnvelope = executeChildOperation(input, options, controls);

  auditTrail.push(createAuditTrailEvent({
    step: 'domain_operation_executed',
    message: 'AI Finance Tool delegated the request to the selected domain operation.',
    details: {
      requestedOperation: options.operation,
      childOperation: childEnvelope.operation,
      childSuccess: childEnvelope.success,
      childWarningCount: childEnvelope.warnings.length,
      childErrorCount: childEnvelope.errors.length,
    },
  }));

  const mergedWarnings = [...warnings, ...childEnvelope.warnings];
  const mergedErrors = [...errors, ...childEnvelope.errors];
  const agentInstructions = createAgentInstructions(options.operation, mergedWarnings);
  const data: AiFinanceToolData = {
    requestedOperation: options.operation,
    executedOperation: childEnvelope.operation,
    result: childEnvelope.data,
    childSuccess: childEnvelope.success,
    childMetadata: childEnvelope.metadata,
    controls,
    summary: buildToolSummary(options.operation, childEnvelope),
    limitations: buildLimitations(options.operation),
    agentInstructions,
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'agent_response_prepared',
    message: 'AI Agent response instructions were prepared.',
    details: agentInstructions,
  }));
  auditTrail.push(createAuditTrailEvent({
    step: 'operation_completed',
    message: childEnvelope.success
      ? 'AI Finance Tool operation completed successfully.'
      : 'AI Finance Tool operation completed with child operation errors.',
    details: {
      success: childEnvelope.success,
      warningCount: mergedWarnings.length,
      errorCount: mergedErrors.length,
    },
  }));

  const outputParams = {
    operation: options.operation,
    data,
    metadata: {
      rowCount,
      columnCount: estimateColumnCount(input),
      generatedAt,
      startedAt,
    },
    warnings: mergedWarnings,
    errors: mergedErrors,
    auditTrail,
  };

  return mergedErrors.length === 0
    ? createSuccessOutput(outputParams)
    : createFailureOutput<AiFinanceToolData>(outputParams);
}
function executeChildOperation(
  input: unknown,
  options: AiFinanceToolOptions,
  controls: ResolvedControls,
): StandardNodeOutput<unknown> {
  const domainOptions = options.domainOptions ?? {};
  const rowInput = resolveRowsInput(input);
  const objectInput = resolveObjectInput(input);

  switch (options.operation) {
    case 'profile_data':
      return profileDataset(rowInput, domainOptions as ProfileDatasetOptions) as StandardNodeOutput<unknown>;
    case 'clean_data':
      return cleanDataset(rowInput, domainOptions as CleanDatasetOptions) as StandardNodeOutput<unknown>;
    case 'normalize_data':
      return normalizeDataset(rowInput, domainOptions as NormalizeDatasetOptions) as StandardNodeOutput<unknown>;
    case 'calculate_statistics':
      return calculateStatistics(rowInput, {
        ...(domainOptions as Partial<CalculateStatisticsOptions>),
        operation: options.statisticsOperation ?? asStatisticsOperation(domainOptions.operation) ?? 'summary_statistics',
        secondaryValueColumn: options.secondaryValueColumn ?? asString(domainOptions.secondaryValueColumn),
        valueColumn: options.valueColumn ?? asString(domainOptions.valueColumn),
      }) as StandardNodeOutput<unknown>;
    case 'calculate_financial_ratios':
      return calculateFinancialRatios(objectInput, {
        ...(domainOptions as Partial<CalculateFinancialRatiosOptions>),
        operation: 'calculate_financial_ratios',
        currency: options.currency ?? asString(domainOptions.currency),
        ratios: options.ratios ?? asRatios(domainOptions.ratios),
      }) as StandardNodeOutput<unknown>;
    case 'validate_accounting_entries':
      return validateJournalEntries(objectInput, {
        ...(domainOptions as Partial<AccountingValidationOptions>),
        operation: options.accountingOperation ?? asAccountingOperation(domainOptions.operation) ?? 'validate_and_build_trial_balance',
        currency: options.currency ?? asString(domainOptions.currency),
      }) as StandardNodeOutput<unknown>;
    case 'build_financial_report':
      return buildFinancialReport(objectInput, {
        ...(domainOptions as Partial<BuildFinancialReportOptions>),
        operation: 'build_financial_report',
        currency: options.currency ?? asString(domainOptions.currency),
        reportType: options.financialReportType ?? asFinancialReportType(domainOptions.reportType) ?? 'executive_summary',
      }) as StandardNodeOutput<unknown>;
    case 'forecast_financial_metric':
      return runPredictiveAnalytics(rowInput, {
        ...(domainOptions as Partial<PredictiveAnalyticsOptions>),
        operation: options.predictiveOperation ?? asPredictiveOperation(domainOptions.operation) ?? 'moving_average_forecast',
        currency: options.currency ?? asString(domainOptions.currency),
        horizon: resolveForecastHorizon(options),
        maxHorizon: controls.maxForecastHorizon,
        valueColumn: options.valueColumn ?? asString(domainOptions.valueColumn),
        windowSize: asNumber(domainOptions.windowSize),
        xColumn: options.xColumn ?? asString(domainOptions.xColumn),
      }) as StandardNodeOutput<unknown>;
    case 'train_simple_regression':
      return runPredictiveAnalytics(rowInput, {
        ...(domainOptions as Partial<PredictiveAnalyticsOptions>),
        operation: 'simple_linear_regression',
        currency: options.currency ?? asString(domainOptions.currency),
        horizon: resolveForecastHorizon(options),
        maxHorizon: controls.maxForecastHorizon,
        valueColumn: options.valueColumn ?? asString(domainOptions.valueColumn),
        xColumn: options.xColumn ?? asString(domainOptions.xColumn),
      }) as StandardNodeOutput<unknown>;
    case 'evaluate_prediction_model':
      return evaluatePredictionModel(rowInput, {
        actualColumn: options.actualColumn ?? asString(domainOptions.actualColumn) ?? 'actual',
        predictedColumn: options.predictedColumn ?? asString(domainOptions.predictedColumn) ?? 'predicted',
      }) as StandardNodeOutput<unknown>;
  }
}

function evaluatePredictionModel(
  input: unknown,
  options: { actualColumn: string; predictedColumn: string },
): StandardNodeOutput<PredictionEvaluationData> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const warnings: AiFinanceToolWarning[] = [];
  const errors: AiFinanceToolError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_validation',
      message: 'Prediction evaluation input received.',
    }),
  ];

  if (!Array.isArray(input) || !input.every(isRecord)) {
    errors.push({ code: 'INVALID_INPUT', severity: 'error', message: 'Prediction evaluation expects an array of JSON rows.' });
    return createFailureOutput<PredictionEvaluationData>({
      operation: 'evaluate_prediction_model',
      data: null,
      metadata: { rowCount: 0, columnCount: 0, generatedAt, startedAt },
      warnings,
      errors,
      auditTrail,
    });
  }

  const actualColumn = options.actualColumn.trim();
  const predictedColumn = options.predictedColumn.trim();

  if (!actualColumn || !predictedColumn) {
    errors.push({
      code: 'MISSING_EVALUATION_COLUMNS',
      severity: 'error',
      message: 'actualColumn and predictedColumn are required for prediction evaluation.',
    });
    return createFailureOutput<PredictionEvaluationData>({
      operation: 'evaluate_prediction_model',
      data: null,
      metadata: { rowCount: input.length, columnCount: estimateColumnCount(input), generatedAt, startedAt },
      warnings,
      errors,
      auditTrail,
    });
  }

  const actualValues: Decimal[] = [];
  const predictedValues: Decimal[] = [];
  let ignoredPairCount = 0;

  for (const row of input) {
    const actual = parseDecimal(row[actualColumn]);
    const predicted = parseDecimal(row[predictedColumn]);

    if (!actual.parsed || actual.value === null || !predicted.parsed || predicted.value === null) {
      ignoredPairCount += 1;
      continue;
    }

    actualValues.push(actual.value);
    predictedValues.push(predicted.value);
  }

  if (ignoredPairCount > 0) {
    warnings.push({
      code: 'EVALUATION_PAIRS_IGNORED',
      severity: 'warning',
      message: 'Rows with missing or non-decimal actual/predicted values were ignored.',
      details: { ignoredPairCount },
    });
  }

  if (actualValues.length === 0) {
    errors.push({
      code: 'NO_VALID_EVALUATION_PAIRS',
      severity: 'error',
      message: 'No valid actual/predicted pairs were available for evaluation.',
    });
    return createFailureOutput<PredictionEvaluationData>({
      operation: 'evaluate_prediction_model',
      data: null,
      metadata: { rowCount: input.length, columnCount: estimateColumnCount(input), generatedAt, startedAt },
      warnings,
      errors,
      auditTrail,
    });
  }

  const metrics = calculateEvaluationMetrics(actualValues, predictedValues);
  const data: PredictionEvaluationData = {
    actualColumn,
    predictedColumn,
    validPairCount: actualValues.length,
    ignoredPairCount,
    metrics,
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'operation_completed',
    message: 'Prediction evaluation completed.',
    details: { validPairCount: actualValues.length, ignoredPairCount },
  }));

  return createSuccessOutput({
    operation: 'evaluate_prediction_model',
    data,
    metadata: { rowCount: input.length, columnCount: estimateColumnCount(input), generatedAt, startedAt },
    warnings,
    errors,
    auditTrail,
  });
}
function createAiFailure({
  operation,
  generatedAt,
  startedAt,
  rowCount,
  warnings,
  errors,
  auditTrail,
  message,
}: {
  operation: string;
  generatedAt: string;
  startedAt: number;
  rowCount: number;
  warnings: AiFinanceToolWarning[];
  errors: AiFinanceToolError[];
  auditTrail: AuditTrailEntry[];
  message: string;
}): ToolEnvelope<AiFinanceToolData> {
  return createFailureOutput<AiFinanceToolData>({
    operation,
    data: null,
    metadata: { rowCount, columnCount: 0, generatedAt, startedAt },
    warnings,
    errors,
    auditTrail: [
      ...auditTrail,
      createAuditTrailEvent({
        step: 'operation_completed',
        message,
        details: { errorCount: errors.length, warningCount: warnings.length },
      }),
    ],
  });
}

function calculateEvaluationMetrics(actual: Decimal[], predicted: Decimal[]): PredictionEvaluationData['metrics'] {
  const errors = actual.map((value, index) => value.minus(predicted[index]));
  const absoluteErrors = errors.map((error) => error.abs());
  const squaredErrors = errors.map((error) => error.pow(2));
  const mae = averageDecimals(absoluteErrors);
  const mse = averageDecimals(squaredErrors);
  const rmse = decimalSqrt(mse);
  const nonZeroActuals = actual
    .map((value, index) => (value.isZero() ? null : value.minus(predicted[index]).abs().div(value.abs())))
    .filter((value): value is Decimal => value !== null);
  const mape = nonZeroActuals.length === 0 ? null : averageDecimals(nonZeroActuals).mul(100);

  return {
    mae: formatDecimal(mae),
    mse: formatDecimal(mse),
    rmse: formatDecimal(rmse),
    mape: mape === null ? null : formatDecimal(mape),
    zeroActualCount: actual.length - nonZeroActuals.length,
  };
}

function buildToolSummary(operation: AiFinanceToolOperation, childEnvelope: StandardNodeOutput<unknown>): string {
  const status = childEnvelope.success ? 'successfully' : 'with errors';
  return `AI Finance Tool executed "${operation}" ${status}. Warnings: ${childEnvelope.warnings.length}. Errors: ${childEnvelope.errors.length}.`;
}

function buildLimitations(operation: AiFinanceToolOperation): string[] {
  const limitations = [
    'AI Finance Tool only executes allowlisted deterministic operations.',
    'The AI Agent must mention warnings and must not infer missing business context.',
  ];

  if (PREDICTIVE_OPERATIONS.has(operation)) {
    limitations.push('Predictive outputs are directional and should not be interpreted as certainty.');
    limitations.push('Correlation or trend does not imply causality.');
  }

  return limitations;
}

function createAgentInstructions(operation: AiFinanceToolOperation, warnings: AiFinanceToolWarning[]): AgentInstructions {
  return {
    canSummarize: true,
    mustMentionWarnings: warnings.length > 0,
    mustNotOverstatePredictions: PREDICTIVE_OPERATIONS.has(operation),
    mustNotAssumeCausality: PREDICTIVE_OPERATIONS.has(operation),
    recommendedPrompt: PREDICTIVE_OPERATIONS.has(operation)
      ? 'Summarize the forecast or evaluation, mention warnings and limitations, and state clearly that predictions are directional, not certainty.'
      : 'Summarize the result, mention warnings and errors, and avoid assuming missing financial context.',
  };
}

function resolveControls(options: AiFinanceToolOptions, rowCount: number): ResolvedControls {
  return {
    allowPredictiveOperations: options.allowPredictiveOperations ?? false,
    maxForecastHorizon: resolvePositiveInteger(options.maxForecastHorizon, DEFAULT_MAX_FORECAST_HORIZON),
    maxRows: resolvePositiveInteger(options.maxRows, DEFAULT_MAX_ROWS),
    rowCount,
  };
}

function resolveForecastHorizon(options: AiFinanceToolOptions): number {
  return resolvePositiveInteger(options.forecastHorizon, 3);
}

function resolveRowsInput(input: unknown): unknown {
  if (isRecord(input) && Array.isArray(input.data)) return input.data;
  return input;
}

function resolveObjectInput(input: unknown): unknown {
  if (isRecord(input) && input.data !== undefined && !Array.isArray(input.data)) return input.data;
  if (Array.isArray(input) && input.length === 1) return input[0];
  return input;
}

function countRows(input: unknown): number {
  const rows = resolveRowsInput(input);
  if (Array.isArray(rows)) return rows.length;
  return isRecord(rows) ? 1 : 0;
}

function estimateColumnCount(input: unknown): number {
  const rows = resolveRowsInput(input);
  const names = new Set<string>();

  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (isRecord(row)) for (const key of Object.keys(row)) names.add(key);
    }
    return names.size;
  }

  return isRecord(rows) ? Object.keys(rows).length : 0;
}

function parseDecimal(value: unknown): ParsedDecimalValue {
  if (value instanceof Decimal) return { parsed: value.isFinite(), value: value.isFinite() ? value : null };
  if (typeof value === 'number') return Number.isFinite(value) ? { parsed: true, value: new Decimal(value.toString()) } : { parsed: false, value: null };
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

function averageDecimals(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0)).div(values.length);
}

function decimalSqrt(value: Decimal): Decimal {
  return new Decimal(Math.sqrt(value.toNumber()).toString());
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asRatios(value: unknown): AiFinanceToolOptions['ratios'] {
  return Array.isArray(value) ? value as AiFinanceToolOptions['ratios'] : undefined;
}

function asStatisticsOperation(value: unknown): AiFinanceToolOptions['statisticsOperation'] {
  return typeof value === 'string' ? value as AiFinanceToolOptions['statisticsOperation'] : undefined;
}

function asAccountingOperation(value: unknown): AiFinanceToolOptions['accountingOperation'] {
  return typeof value === 'string' ? value as AiFinanceToolOptions['accountingOperation'] : undefined;
}

function asFinancialReportType(value: unknown): AiFinanceToolOptions['financialReportType'] {
  return typeof value === 'string' ? value as AiFinanceToolOptions['financialReportType'] : undefined;
}

function asPredictiveOperation(value: unknown): AiFinanceToolOptions['predictiveOperation'] {
  return typeof value === 'string' ? value as AiFinanceToolOptions['predictiveOperation'] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAiFinanceToolOperation(value: unknown): value is AiFinanceToolOperation {
  return typeof value === 'string' && SUPPORTED_AI_FINANCE_TOOL_OPERATIONS.includes(value as AiFinanceToolOperation);
}


import Decimal from 'decimal.js';
import * as statistics from 'simple-statistics';
import { z } from 'zod';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AuditTrailEntry,
  CagrData,
  CagrPoint,
  CalculateStatisticsOptions,
  CalculateStatisticsResult,
  CorrelationData,
  DataRow,
  GroupAggregateData,
  GroupAggregateEntry,
  GroupAggregation,
  GrowthRateData,
  GrowthRateMode,
  GrowthRatePoint,
  MathStatisticsError,
  MathStatisticsOperation,
  MathStatisticsWarning,
  OutliersIqrData,
  PercentileData,
  SummaryStatistics,
  SummaryStatisticsData,
  ToolEnvelope,
  ZScoreData,
} from './types';

const inputSchema = z.array(z.record(z.string(), z.unknown()));

const SUPPORTED_OPERATIONS: readonly MathStatisticsOperation[] = [
  'summary_statistics',
  'percentile',
  'correlation',
  'growth_rate',
  'cagr',
  'z_score',
  'outliers_iqr',
  'group_aggregate',
];

const SUPPORTED_GROUP_AGGREGATIONS: readonly GroupAggregation[] = [
  'count',
  'sum',
  'mean',
  'min',
  'max',
];

interface ResolvedCalculateStatisticsOptions {
  operation: MathStatisticsOperation;
  valueColumn: string;
  secondaryValueColumn: string;
  groupColumn: string;
  percentile: number;
  growthMode: GrowthRateMode;
  cagrPeriods: unknown;
  resultColumn: string;
  aggregations: GroupAggregation[];
}

interface ParsedDecimalValue {
  parsed: boolean;
  value: Decimal | null;
}

interface NumericObservation {
  rowIndex: number;
  value: Decimal;
  numberValue: number;
}

interface NumericObservationCollection {
  observations: NumericObservation[];
  ignoredCount: number;
  missingCount: number;
  nonNumericCount: number;
  unsafeNumberCount: number;
}

interface NumericPair {
  rowIndex: number;
  x: Decimal;
  y: Decimal;
  xNumber: number;
  yNumber: number;
}

interface NumericPairCollection {
  pairs: NumericPair[];
  ignoredPairCount: number;
  nonNumericPairCount: number;
  missingPairCount: number;
  unsafeNumberPairCount: number;
}

interface GroupAccumulator {
  groupValue: unknown;
  rowCount: number;
  values: Decimal[];
  ignoredValueCount: number;
  nonNumericValueCount: number;
}

export function calculateStatistics(
  input: unknown,
  options: CalculateStatisticsOptions,
): ToolEnvelope<CalculateStatisticsResult> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const operation = isMathStatisticsOperation(options.operation)
    ? options.operation
    : 'summary_statistics';
  const warnings: MathStatisticsWarning[] = [];
  const errors: MathStatisticsError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_received',
      message: 'Math and statistics calculation started.',
      details: {
        requestedOperation: options.operation,
      },
    }),
  ];

  if (!isMathStatisticsOperation(options.operation)) {
    errors.push({
      code: 'UNSUPPORTED_OPERATION',
      severity: 'error',
      message: `Unsupported operation: ${String(options.operation)}`,
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
      failureStep: 'operation_rejected',
      failureMessage: 'The requested math/statistics operation is not supported.',
    });
  }

  const parsed = inputSchema.safeParse(input);

  if (!parsed.success) {
    errors.push({
      code: 'INVALID_INPUT',
      severity: 'error',
      message: 'Expected an array of JSON objects, where each object represents one row.',
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
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
      failureStep: 'validation_failed',
      failureMessage: 'Input validation failed.',
    });
  }

  const rows = parsed.data;
  const columnNames = getColumnNames(rows);
  const columnNameSet = new Set(columnNames);
  const resolvedOptions = resolveOptions(options);

  auditTrail.push(createAuditTrailEvent({
    step: 'schema_detected',
    message: 'Columns were collected from input rows.',
    details: {
      rowCount: rows.length,
      columnCount: columnNames.length,
    },
  }));

  validateOperationOptions(resolvedOptions, columnNameSet, errors);

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
      failureStep: 'validation_failed',
      failureMessage: 'Operation parameters failed validation.',
    });
  }

  const data = runCalculation({
    rows,
    options: resolvedOptions,
    warnings,
    errors,
  });

  if (errors.length > 0 || data === null) {
    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: rows.length,
      columnCount: columnNames.length,
      warnings,
      errors,
      auditTrail,
      failureStep: 'calculation_failed',
      failureMessage: 'Math/statistics calculation could not be completed.',
    });
  }

  auditTrail.push(createAuditTrailEvent({
    step: 'calculation_completed',
    message: 'Math/statistics calculation completed.',
    details: {
      operation,
      warnings: warnings.length,
      errors: errors.length,
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

function createFailureEnvelope({
  operation,
  generatedAt,
  startedAt,
  rowCount,
  columnCount,
  warnings,
  errors,
  auditTrail,
  failureStep,
  failureMessage,
}: {
  operation: MathStatisticsOperation;
  generatedAt: string;
  startedAt: number;
  rowCount: number;
  columnCount: number;
  warnings: MathStatisticsWarning[];
  errors: MathStatisticsError[];
  auditTrail: AuditTrailEntry[];
  failureStep: string;
  failureMessage: string;
}): ToolEnvelope<CalculateStatisticsResult> {
  return createFailureOutput<CalculateStatisticsResult>({
    operation,
    data: null,
    metadata: {
      rowCount,
      columnCount,
      generatedAt,
      startedAt,
    },
    warnings,
    errors,
    auditTrail: [
      ...auditTrail,
      createAuditTrailEvent({
        step: failureStep,
        message: failureMessage,
      }),
    ],
  });
}

function resolveOptions(options: CalculateStatisticsOptions): ResolvedCalculateStatisticsOptions {
  return {
    operation: options.operation,
    valueColumn: cleanColumnName(options.valueColumn),
    secondaryValueColumn: cleanColumnName(options.secondaryValueColumn),
    groupColumn: cleanColumnName(options.groupColumn),
    percentile: options.percentile ?? 50,
    growthMode: options.growthMode ?? 'first_last',
    cagrPeriods: options.cagrPeriods ?? 1,
    resultColumn: cleanColumnName(options.resultColumn) || 'zScore',
    aggregations: normalizeAggregations(options.aggregations),
  };
}

function cleanColumnName(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeAggregations(aggregations: GroupAggregation[] | undefined): GroupAggregation[] {
  const requestedAggregations = aggregations?.length ? aggregations : ['count', 'sum', 'mean'];
  const normalized: GroupAggregation[] = [];

  for (const aggregation of requestedAggregations) {
    if (isGroupAggregation(aggregation) && !normalized.includes(aggregation)) {
      normalized.push(aggregation);
    }
  }

  return normalized;
}

function validateOperationOptions(
  options: ResolvedCalculateStatisticsOptions,
  columnNames: Set<string>,
  errors: MathStatisticsError[],
): void {
  switch (options.operation) {
    case 'summary_statistics':
    case 'percentile':
    case 'z_score':
    case 'outliers_iqr':
      validateRequiredColumn(options.valueColumn, 'Value Column', columnNames, errors);
      break;

    case 'correlation':
      validateRequiredColumn(options.valueColumn, 'Correlation X Column', columnNames, errors);
      validateRequiredColumn(options.secondaryValueColumn, 'Correlation Y Column', columnNames, errors);
      break;

    case 'growth_rate':
      validateGrowthRateOptions(options, columnNames, errors);
      break;

    case 'cagr':
      validateRequiredColumn(options.valueColumn, 'CAGR Start Value Column', columnNames, errors);
      validateRequiredColumn(options.secondaryValueColumn, 'CAGR End Value Column', columnNames, errors);
      validateCagrPeriods(options.cagrPeriods, errors);
      break;

    case 'group_aggregate':
      validateGroupAggregateOptions(options, columnNames, errors);
      break;
  }

  if (options.operation === 'percentile') {
    validatePercentile(options.percentile, errors);
  }
}

function validateGrowthRateOptions(
  options: ResolvedCalculateStatisticsOptions,
  columnNames: Set<string>,
  errors: MathStatisticsError[],
): void {
  if (options.growthMode !== 'first_last' && options.growthMode !== 'columns') {
    errors.push({
      code: 'INVALID_GROWTH_MODE',
      severity: 'error',
      message: 'Growth mode must be either "first_last" or "columns".',
      field: 'growthMode',
    });
    return;
  }

  if (options.growthMode === 'first_last') {
    validateRequiredColumn(options.valueColumn, 'Value Column', columnNames, errors);
    return;
  }

  validateRequiredColumn(options.valueColumn, 'Growth Start Column', columnNames, errors);
  validateRequiredColumn(options.secondaryValueColumn, 'Growth End Column', columnNames, errors);
}

function validateGroupAggregateOptions(
  options: ResolvedCalculateStatisticsOptions,
  columnNames: Set<string>,
  errors: MathStatisticsError[],
): void {
  validateRequiredColumn(options.groupColumn, 'Group Column', columnNames, errors);

  if (options.aggregations.length === 0) {
    errors.push({
      code: 'INVALID_AGGREGATIONS',
      severity: 'error',
      message: 'At least one supported group aggregation is required.',
      field: 'aggregations',
      details: {
        supportedAggregations: SUPPORTED_GROUP_AGGREGATIONS,
      },
    });
  }

  const requiresValueColumn = options.aggregations.some((aggregation) => aggregation !== 'count');

  if (requiresValueColumn) {
    validateRequiredColumn(options.valueColumn, 'Value Column', columnNames, errors);
  } else if (options.valueColumn && !columnNames.has(options.valueColumn)) {
    errors.push(createColumnNotFoundError(options.valueColumn, 'Value Column'));
  }
}

function validateRequiredColumn(
  columnName: string,
  parameterName: string,
  columnNames: Set<string>,
  errors: MathStatisticsError[],
): void {
  if (!columnName) {
    errors.push({
      code: 'MISSING_REQUIRED_COLUMN',
      severity: 'error',
      message: `${parameterName} is required for this operation.`,
      details: {
        parameterName,
      },
    });
    return;
  }

  if (!columnNames.has(columnName)) {
    errors.push(createColumnNotFoundError(columnName, parameterName));
  }
}

function createColumnNotFoundError(columnName: string, parameterName: string): MathStatisticsError {
  return {
    code: 'COLUMN_NOT_FOUND',
    severity: 'error',
    message: `Column "${columnName}" does not exist in the input rows.`,
    field: columnName,
    details: {
      parameterName,
    },
  };
}

function validatePercentile(percentile: number, errors: MathStatisticsError[]): void {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
    errors.push({
      code: 'INVALID_PERCENTILE',
      severity: 'error',
      message: 'Percentile must be a number between 0 and 100.',
      field: 'percentile',
      details: {
        percentile,
      },
    });
  }
}

function validateCagrPeriods(periods: unknown, errors: MathStatisticsError[]): void {
  const parsed = parseDecimalValue(periods);

  if (!parsed.parsed || parsed.value === null || parsed.value.lte(0)) {
    errors.push({
      code: 'INVALID_CAGR_PERIODS',
      severity: 'error',
      message: 'CAGR periods must be a positive numeric value.',
      field: 'cagrPeriods',
      details: {
        periods,
      },
    });
  }
}

function runCalculation({
  rows,
  options,
  warnings,
  errors,
}: {
  rows: DataRow[];
  options: ResolvedCalculateStatisticsOptions;
  warnings: MathStatisticsWarning[];
  errors: MathStatisticsError[];
}): CalculateStatisticsResult | null {
  switch (options.operation) {
    case 'summary_statistics':
      return calculateSummaryStatistics(rows, options, warnings, errors);
    case 'percentile':
      return calculatePercentile(rows, options, warnings);
    case 'correlation':
      return calculateCorrelation(rows, options, warnings);
    case 'growth_rate':
      return calculateGrowthRate(rows, options, warnings);
    case 'cagr':
      return calculateCagr(rows, options, warnings);
    case 'z_score':
      return calculateZScore(rows, options, warnings);
    case 'outliers_iqr':
      return calculateOutliersIqr(rows, options, warnings);
    case 'group_aggregate':
      return calculateGroupAggregate(rows, options, warnings);
  }
}

function calculateSummaryStatistics(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
  errors: MathStatisticsError[],
): SummaryStatisticsData | null {
  const collection = collectNumericObservations(rows, options.valueColumn);
  addNumericCollectionWarnings(warnings, options.valueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.observations.length, 2);

  if (collection.observations.length === 0) {
    errors.push({
      code: 'NO_NUMERIC_VALUES',
      severity: 'error',
      message: `Column "${options.valueColumn}" does not contain numeric values to summarize.`,
      field: options.valueColumn,
    });
    return null;
  }

  const values = collection.observations.map((observation) => observation.value);
  const numberValues = collection.observations.map((observation) => observation.numberValue);
  const computedStatistics = calculateSummary(values, numberValues);

  if (computedStatistics.standardDeviation === 0) {
    addZeroStandardDeviationWarning(warnings, options.valueColumn);
  }

  return {
    column: options.valueColumn,
    ignoredCount: collection.ignoredCount,
    statistics: computedStatistics,
  };
}

function calculatePercentile(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): PercentileData {
  const collection = collectNumericObservations(rows, options.valueColumn);
  addNumericCollectionWarnings(warnings, options.valueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.observations.length, 2);

  const sorted = collection.observations
    .map((observation) => observation.numberValue)
    .sort((left, right) => left - right);
  const value = sorted.length === 0
    ? null
    : round(statistics.quantileSorted(sorted, options.percentile / 100));

  return {
    column: options.valueColumn,
    percentile: options.percentile,
    value,
    validCount: sorted.length,
    ignoredCount: collection.ignoredCount,
    limitation: 'Percentiles convert decimal values to JavaScript Number for descriptive statistics.',
  };
}

function calculateCorrelation(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): CorrelationData {
  const collection = collectNumericPairs(rows, options.valueColumn, options.secondaryValueColumn);
  addNumericPairWarnings(warnings, options.valueColumn, options.secondaryValueColumn, collection);

  if (collection.pairs.length < 2) {
    warnings.push({
      code: 'INSUFFICIENT_CORRELATION_OBSERVATIONS',
      severity: 'warning',
      message: 'Correlation requires at least 2 valid paired numeric observations.',
      details: {
        xColumn: options.valueColumn,
        yColumn: options.secondaryValueColumn,
        validPairCount: collection.pairs.length,
      },
    });

    return {
      xColumn: options.valueColumn,
      yColumn: options.secondaryValueColumn,
      method: 'pearson',
      correlation: null,
      validPairCount: collection.pairs.length,
      ignoredPairCount: collection.ignoredPairCount,
    };
  }

  const xValues = collection.pairs.map((pair) => pair.xNumber);
  const yValues = collection.pairs.map((pair) => pair.yNumber);
  const xStandardDeviation = statistics.standardDeviation(xValues);
  const yStandardDeviation = statistics.standardDeviation(yValues);

  if (xStandardDeviation === 0) {
    addZeroStandardDeviationWarning(warnings, options.valueColumn);
  }

  if (yStandardDeviation === 0) {
    addZeroStandardDeviationWarning(warnings, options.secondaryValueColumn);
  }

  const correlation = xStandardDeviation === 0 || yStandardDeviation === 0
    ? null
    : round(statistics.sampleCorrelation(xValues, yValues));

  return {
    xColumn: options.valueColumn,
    yColumn: options.secondaryValueColumn,
    method: 'pearson',
    correlation,
    validPairCount: collection.pairs.length,
    ignoredPairCount: collection.ignoredPairCount,
  };
}

function calculateGrowthRate(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): GrowthRateData {
  if (options.growthMode === 'columns') {
    return calculateColumnGrowthRate(rows, options, warnings);
  }

  const collection = collectNumericObservations(rows, options.valueColumn);
  addNumericCollectionWarnings(warnings, options.valueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.observations.length, 2);

  if (collection.observations.length < 2) {
    return {
      mode: 'first_last',
      column: options.valueColumn,
      validCount: collection.observations.length,
      ignoredCount: collection.ignoredCount,
      divisionByZeroCount: 0,
      result: null,
      rowResults: [],
    };
  }

  const startObservation = collection.observations[0];
  const endObservation = collection.observations[collection.observations.length - 1];
  const growthPoint = calculateGrowthRatePoint(startObservation.value, endObservation.value);
  const divisionByZeroCount = growthPoint.growthRate === null ? 1 : 0;

  if (divisionByZeroCount > 0) {
    addDivisionByZeroWarning(warnings, options.operation, divisionByZeroCount);
  }

  return {
    mode: 'first_last',
    column: options.valueColumn,
    validCount: collection.observations.length,
    ignoredCount: collection.ignoredCount,
    divisionByZeroCount,
    result: growthPoint,
    rowResults: [],
  };
}

function calculateColumnGrowthRate(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): GrowthRateData {
  const collection = collectNumericPairs(rows, options.valueColumn, options.secondaryValueColumn);
  addNumericPairWarnings(warnings, options.valueColumn, options.secondaryValueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.pairs.length, 1);

  const rowResults = collection.pairs.map((pair) => ({
    rowIndex: pair.rowIndex,
    ...calculateGrowthRatePoint(pair.x, pair.y),
  }));
  const divisionByZeroCount = rowResults.filter((result) => result.growthRate === null).length;

  if (divisionByZeroCount > 0) {
    addDivisionByZeroWarning(warnings, options.operation, divisionByZeroCount);
  }

  return {
    mode: 'columns',
    startColumn: options.valueColumn,
    endColumn: options.secondaryValueColumn,
    validCount: collection.pairs.length,
    ignoredCount: collection.ignoredPairCount,
    divisionByZeroCount,
    result: null,
    rowResults,
  };
}

function calculateGrowthRatePoint(startValue: Decimal, endValue: Decimal): GrowthRatePoint {
  if (startValue.isZero()) {
    return {
      startValue: formatDecimal(startValue),
      endValue: formatDecimal(endValue),
      growthRate: null,
      growthRatePercent: null,
    };
  }

  const growthRate = endValue.minus(startValue).div(startValue);

  return {
    startValue: formatDecimal(startValue),
    endValue: formatDecimal(endValue),
    growthRate: formatDecimal(growthRate),
    growthRatePercent: formatDecimal(growthRate.mul(100)),
  };
}

function calculateCagr(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): CagrData {
  const periods = parseDecimalValue(options.cagrPeriods).value as Decimal;
  const collection = collectNumericPairs(rows, options.valueColumn, options.secondaryValueColumn);
  addNumericPairWarnings(warnings, options.valueColumn, options.secondaryValueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.pairs.length, 1);

  const rowResults: CagrPoint[] = [];
  let nonPositiveStartCount = 0;

  for (const pair of collection.pairs) {
    if (pair.x.lte(0)) {
      nonPositiveStartCount += 1;
      rowResults.push({
        rowIndex: pair.rowIndex,
        startValue: formatDecimal(pair.x),
        endValue: formatDecimal(pair.y),
        periods: formatDecimal(periods),
        cagr: null,
        cagrPercent: null,
      });
      continue;
    }

    if (pair.y.lt(0)) {
      rowResults.push({
        rowIndex: pair.rowIndex,
        startValue: formatDecimal(pair.x),
        endValue: formatDecimal(pair.y),
        periods: formatDecimal(periods),
        cagr: null,
        cagrPercent: null,
      });
      continue;
    }

    const cagr = pair.y.div(pair.x).pow(new Decimal(1).div(periods)).minus(1);

    rowResults.push({
      rowIndex: pair.rowIndex,
      startValue: formatDecimal(pair.x),
      endValue: formatDecimal(pair.y),
      periods: formatDecimal(periods),
      cagr: cagr.isFinite() ? formatDecimal(cagr) : null,
      cagrPercent: cagr.isFinite() ? formatDecimal(cagr.mul(100)) : null,
    });
  }

  if (nonPositiveStartCount > 0) {
    warnings.push({
      code: 'CAGR_NON_POSITIVE_INITIAL_VALUE',
      severity: 'warning',
      message: 'CAGR requires initial values greater than zero.',
      details: {
        startColumn: options.valueColumn,
        nonPositiveStartCount,
      },
    });
  }

  return {
    startColumn: options.valueColumn,
    endColumn: options.secondaryValueColumn,
    periods: formatDecimal(periods),
    validPairCount: collection.pairs.length,
    ignoredPairCount: collection.ignoredPairCount,
    nonPositiveStartCount,
    rowResults,
  };
}

function calculateZScore(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): ZScoreData {
  const collection = collectNumericObservations(rows, options.valueColumn);
  addNumericCollectionWarnings(warnings, options.valueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.observations.length, 2);

  if (collection.observations.length === 0) {
    return {
      column: options.valueColumn,
      resultColumn: options.resultColumn,
      validCount: 0,
      ignoredCount: collection.ignoredCount,
      mean: null,
      standardDeviation: 0,
      scores: [],
      rows: rows.map((row) => ({ ...row, [options.resultColumn]: null })),
    };
  }

  const decimalValues = collection.observations.map((observation) => observation.value);
  const numberValues = collection.observations.map((observation) => observation.numberValue);
  const sum = decimalValues.reduce((total, value) => total.plus(value), new Decimal(0));
  const mean = sum.div(decimalValues.length);
  const standardDeviation = round(
    collection.observations.length > 1 ? statistics.standardDeviation(numberValues) : 0,
  );
  const scoreByRowIndex = new Map<number, number | null>();

  if (standardDeviation === 0) {
    addZeroStandardDeviationWarning(warnings, options.valueColumn);
  }

  for (const observation of collection.observations) {
    scoreByRowIndex.set(
      observation.rowIndex,
      standardDeviation === 0
        ? null
        : round(observation.value.minus(mean).div(standardDeviation).toNumber()),
    );
  }

  return {
    column: options.valueColumn,
    resultColumn: options.resultColumn,
    validCount: collection.observations.length,
    ignoredCount: collection.ignoredCount,
    mean: formatDecimal(mean),
    standardDeviation,
    scores: rows.map((row, rowIndex) => ({
      rowIndex,
      value: scoreByRowIndex.has(rowIndex) ? formatDecimal(collection.observations.find(
        (observation) => observation.rowIndex === rowIndex,
      )?.value ?? new Decimal(0)) : null,
      zScore: scoreByRowIndex.get(rowIndex) ?? null,
    })),
    rows: rows.map((row, rowIndex) => ({
      ...row,
      [options.resultColumn]: scoreByRowIndex.get(rowIndex) ?? null,
    })),
  };
}

function calculateOutliersIqr(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): OutliersIqrData {
  const collection = collectNumericObservations(rows, options.valueColumn);
  addNumericCollectionWarnings(warnings, options.valueColumn, collection);
  addFewDataWarning(warnings, options.operation, options.valueColumn, collection.observations.length, 4);

  if (collection.observations.length < 4) {
    return {
      column: options.valueColumn,
      method: 'iqr',
      validCount: collection.observations.length,
      ignoredCount: collection.ignoredCount,
      q1: null,
      q3: null,
      iqr: null,
      lowerFence: null,
      upperFence: null,
      count: 0,
      outliers: [],
      limitation: 'IQR outlier detection requires at least 4 numeric observations for this first cut.',
    };
  }

  const sorted = [...collection.observations].sort((left, right) => left.numberValue - right.numberValue);
  const sortedNumbers = sorted.map((observation) => observation.numberValue);
  const q1 = statistics.quantileSorted(sortedNumbers, 0.25);
  const q3 = statistics.quantileSorted(sortedNumbers, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outliers = collection.observations
    .filter((observation) => observation.numberValue < lowerFence || observation.numberValue > upperFence)
    .map((observation) => ({
      rowIndex: observation.rowIndex,
      value: formatDecimal(observation.value),
      numericValue: observation.numberValue,
    }));

  return {
    column: options.valueColumn,
    method: 'iqr',
    validCount: collection.observations.length,
    ignoredCount: collection.ignoredCount,
    q1: round(q1),
    q3: round(q3),
    iqr: round(iqr),
    lowerFence: round(lowerFence),
    upperFence: round(upperFence),
    count: outliers.length,
    outliers,
    limitation: 'IQR fences convert decimal values to JavaScript Number for descriptive statistics.',
  };
}

function calculateGroupAggregate(
  rows: DataRow[],
  options: ResolvedCalculateStatisticsOptions,
  warnings: MathStatisticsWarning[],
): GroupAggregateData {
  const requiresValueColumn = options.aggregations.some((aggregation) => aggregation !== 'count');
  const groups = new Map<string, GroupAccumulator>();

  for (const row of rows) {
    const groupValue = normalizeGroupValue(row[options.groupColumn]);
    const groupKey = stableStringify(groupValue);
    const accumulator = groups.get(groupKey) ?? {
      groupValue,
      rowCount: 0,
      values: [],
      ignoredValueCount: 0,
      nonNumericValueCount: 0,
    };

    accumulator.rowCount += 1;

    if (requiresValueColumn) {
      const value = row[options.valueColumn];

      if (isMissingValue(value)) {
        accumulator.ignoredValueCount += 1;
      } else {
        const parsed = parseDecimalValue(value);
        const numberValue = parsed.value?.toNumber();

        if (parsed.parsed && parsed.value !== null && Number.isFinite(numberValue)) {
          accumulator.values.push(parsed.value);
        } else {
          accumulator.ignoredValueCount += 1;
          accumulator.nonNumericValueCount += 1;
        }
      }
    }

    groups.set(groupKey, accumulator);
  }

  const nonNumericCount = [...groups.values()].reduce(
    (total, accumulator) => total + accumulator.nonNumericValueCount,
    0,
  );
  const ignoredCount = [...groups.values()].reduce(
    (total, accumulator) => total + accumulator.ignoredValueCount,
    0,
  );

  if (nonNumericCount > 0) {
    warnings.push({
      code: 'NON_NUMERIC_VALUES_IGNORED',
      severity: 'warning',
      message: `Non-numeric values in column "${options.valueColumn}" were ignored.`,
      field: options.valueColumn,
      details: {
        column: options.valueColumn,
        ignoredCount: nonNumericCount,
      },
    });
  }

  const groupEntries = [...groups.values()]
    .sort((left, right) => stableStringify(left.groupValue).localeCompare(stableStringify(right.groupValue)))
    .map((accumulator) => buildGroupAggregateEntry(accumulator, options.aggregations));

  return {
    groupColumn: options.groupColumn,
    valueColumn: requiresValueColumn ? options.valueColumn : undefined,
    aggregations: options.aggregations,
    groupCount: groupEntries.length,
    ignoredCount,
    groups: groupEntries,
  };
}

function buildGroupAggregateEntry(
  accumulator: GroupAccumulator,
  aggregations: GroupAggregation[],
): GroupAggregateEntry {
  const entry: GroupAggregateEntry = {
    groupValue: accumulator.groupValue,
    rowCount: accumulator.rowCount,
    validValueCount: accumulator.values.length,
    ignoredValueCount: accumulator.ignoredValueCount,
  };

  const sortedValues = [...accumulator.values].sort((left, right) => left.comparedTo(right));
  const sum = accumulator.values.reduce((total, value) => total.plus(value), new Decimal(0));

  for (const aggregation of aggregations) {
    switch (aggregation) {
      case 'count':
        entry.count = accumulator.rowCount;
        break;
      case 'sum':
        entry.sum = accumulator.values.length > 0 ? formatDecimal(sum) : null;
        break;
      case 'mean':
        entry.mean = accumulator.values.length > 0 ? formatDecimal(sum.div(accumulator.values.length)) : null;
        break;
      case 'min':
        entry.min = sortedValues.length > 0 ? formatDecimal(sortedValues[0]) : null;
        break;
      case 'max':
        entry.max = sortedValues.length > 0 ? formatDecimal(sortedValues[sortedValues.length - 1]) : null;
        break;
    }
  }

  return entry;
}

function calculateSummary(decimalValues: Decimal[], numberValues: number[]): SummaryStatistics {
  const sortedDecimals = [...decimalValues].sort((left, right) => left.comparedTo(right));
  const sortedNumbers = [...numberValues].sort((left, right) => left - right);
  const sum = decimalValues.reduce((total, value) => total.plus(value), new Decimal(0));
  const variance = numberValues.length > 1 ? statistics.variance(numberValues) : 0;

  return {
    count: decimalValues.length,
    sum: formatDecimal(sum),
    mean: formatDecimal(sum.div(decimalValues.length)),
    median: formatDecimal(calculateMedianDecimal(sortedDecimals)),
    min: formatDecimal(sortedDecimals[0]),
    max: formatDecimal(sortedDecimals[sortedDecimals.length - 1]),
    variance: round(variance),
    standardDeviation: round(numberValues.length > 1 ? statistics.standardDeviation(sortedNumbers) : 0),
  };
}

function calculateMedianDecimal(sortedValues: Decimal[]): Decimal {
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return sortedValues[middleIndex - 1].plus(sortedValues[middleIndex]).div(2);
}

function collectNumericObservations(rows: DataRow[], columnName: string): NumericObservationCollection {
  const observations: NumericObservation[] = [];
  let missingCount = 0;
  let nonNumericCount = 0;
  let unsafeNumberCount = 0;

  rows.forEach((row, rowIndex) => {
    const value = row[columnName];

    if (isMissingValue(value)) {
      missingCount += 1;
      return;
    }

    const parsed = parseDecimalValue(value);
    const numberValue = parsed.value?.toNumber();

    if (parsed.parsed && parsed.value !== null && Number.isFinite(numberValue)) {
      observations.push({
        rowIndex,
        value: parsed.value,
        numberValue,
      });
      return;
    }

    if (parsed.parsed && parsed.value !== null && !Number.isFinite(numberValue)) {
      unsafeNumberCount += 1;
    } else {
      nonNumericCount += 1;
    }
  });

  return {
    observations,
    ignoredCount: rows.length - observations.length,
    missingCount,
    nonNumericCount,
    unsafeNumberCount,
  };
}

function collectNumericPairs(rows: DataRow[], xColumn: string, yColumn: string): NumericPairCollection {
  const pairs: NumericPair[] = [];
  let missingPairCount = 0;
  let nonNumericPairCount = 0;
  let unsafeNumberPairCount = 0;

  rows.forEach((row, rowIndex) => {
    const xValue = row[xColumn];
    const yValue = row[yColumn];

    if (isMissingValue(xValue) || isMissingValue(yValue)) {
      missingPairCount += 1;
      return;
    }

    const parsedX = parseDecimalValue(xValue);
    const parsedY = parseDecimalValue(yValue);
    const xNumber = parsedX.value?.toNumber();
    const yNumber = parsedY.value?.toNumber();

    if (
      parsedX.parsed &&
      parsedY.parsed &&
      parsedX.value !== null &&
      parsedY.value !== null &&
      Number.isFinite(xNumber) &&
      Number.isFinite(yNumber)
    ) {
      pairs.push({
        rowIndex,
        x: parsedX.value,
        y: parsedY.value,
        xNumber,
        yNumber,
      });
      return;
    }

    if (
      parsedX.parsed &&
      parsedY.parsed &&
      parsedX.value !== null &&
      parsedY.value !== null &&
      (!Number.isFinite(xNumber) || !Number.isFinite(yNumber))
    ) {
      unsafeNumberPairCount += 1;
    } else {
      nonNumericPairCount += 1;
    }
  });

  return {
    pairs,
    ignoredPairCount: rows.length - pairs.length,
    nonNumericPairCount,
    missingPairCount,
    unsafeNumberPairCount,
  };
}

function addNumericCollectionWarnings(
  warnings: MathStatisticsWarning[],
  columnName: string,
  collection: NumericObservationCollection,
): void {
  if (collection.nonNumericCount > 0) {
    warnings.push({
      code: 'NON_NUMERIC_VALUES_IGNORED',
      severity: 'warning',
      message: `Non-numeric values in column "${columnName}" were ignored.`,
      field: columnName,
      details: {
        column: columnName,
        ignoredCount: collection.nonNumericCount,
        missingCount: collection.missingCount,
      },
    });
  }

  if (collection.unsafeNumberCount > 0) {
    warnings.push({
      code: 'UNSAFE_NUMBER_VALUES_IGNORED',
      severity: 'warning',
      message: `Values in column "${columnName}" were too large to convert safely for descriptive statistics.`,
      field: columnName,
      details: {
        column: columnName,
        ignoredCount: collection.unsafeNumberCount,
      },
    });
  }
}

function addNumericPairWarnings(
  warnings: MathStatisticsWarning[],
  xColumn: string,
  yColumn: string,
  collection: NumericPairCollection,
): void {
  if (collection.nonNumericPairCount > 0) {
    warnings.push({
      code: 'NON_NUMERIC_VALUES_IGNORED',
      severity: 'warning',
      message: 'Rows with non-numeric paired values were ignored.',
      details: {
        xColumn,
        yColumn,
        ignoredPairCount: collection.nonNumericPairCount,
        missingPairCount: collection.missingPairCount,
      },
    });
  }

  if (collection.unsafeNumberPairCount > 0) {
    warnings.push({
      code: 'UNSAFE_NUMBER_VALUES_IGNORED',
      severity: 'warning',
      message: 'Rows with paired values too large for descriptive statistics were ignored.',
      details: {
        xColumn,
        yColumn,
        ignoredPairCount: collection.unsafeNumberPairCount,
      },
    });
  }
}

function addFewDataWarning(
  warnings: MathStatisticsWarning[],
  operation: MathStatisticsOperation,
  field: string,
  validCount: number,
  minimumRecommended: number,
): void {
  if (validCount >= minimumRecommended) {
    return;
  }

  warnings.push({
    code: 'FEW_DATA_POINTS',
    severity: 'warning',
    message: `Operation "${operation}" has fewer data points than recommended.`,
    field,
    details: {
      operation,
      validCount,
      minimumRecommended,
    },
  });
}

function addZeroStandardDeviationWarning(
  warnings: MathStatisticsWarning[],
  columnName: string,
): void {
  warnings.push({
    code: 'ZERO_STANDARD_DEVIATION',
    severity: 'warning',
    message: `Column "${columnName}" has zero standard deviation.`,
    field: columnName,
  });
}

function addDivisionByZeroWarning(
  warnings: MathStatisticsWarning[],
  operation: MathStatisticsOperation,
  divisionByZeroCount: number,
): void {
  warnings.push({
    code: 'DIVISION_BY_ZERO',
    severity: 'warning',
    message: 'One or more growth calculations had a zero initial value.',
    details: {
      operation,
      divisionByZeroCount,
    },
  });
}

function parseDecimalValue(value: unknown): ParsedDecimalValue {
  if (value instanceof Decimal) {
    return { parsed: value.isFinite(), value: value.isFinite() ? value : null };
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { parsed: true, value: new Decimal(value) }
      : { parsed: false, value: null };
  }

  if (typeof value === 'bigint') {
    return { parsed: true, value: new Decimal(value.toString()) };
  }

  if (typeof value !== 'string') {
    return { parsed: false, value: null };
  }

  const normalized = normalizeNumericString(value);

  if (normalized === null) {
    return { parsed: false, value: null };
  }

  try {
    const decimal = new Decimal(normalized);
    return { parsed: decimal.isFinite(), value: decimal.isFinite() ? decimal : null };
  } catch {
    return { parsed: false, value: null };
  }
}

function normalizeNumericString(input: string): string | null {
  let working = input.normalize('NFKC').replace(/\u00a0/g, ' ').trim();

  if (working === '') {
    return null;
  }

  let negative = false;

  if (/^\(.+\)$/.test(working)) {
    negative = true;
    working = working.slice(1, -1).trim();
  }

  working = working
    .replace(/\b(?:AUD|BRL|CAD|CHF|CNY|EUR|GBP|JPY|MXN|NZD|USD)\b/gi, ' ')
    .replace(/[€$£¥]/g, ' ')
    .trim();

  if (/[A-Za-z]/.test(working)) {
    return null;
  }

  working = working.replace(/[\s'’]/g, '');

  if (working.startsWith('-')) {
    negative = !negative;
    working = working.slice(1);
  } else if (working.startsWith('+')) {
    working = working.slice(1);
  }

  if (/[+-]/.test(working) || working === '') {
    return null;
  }

  const decimalSeparator = resolveDecimalSeparator(working);
  const normalizedMagnitude = applyDecimalSeparator(working, decimalSeparator);

  if (normalizedMagnitude === null || !/^\d+(?:\.\d+)?$/.test(normalizedMagnitude)) {
    return null;
  }

  return negative ? `-${normalizedMagnitude}` : normalizedMagnitude;
}

function resolveDecimalSeparator(value: string): ',' | '.' | null {
  const lastCommaIndex = value.lastIndexOf(',');
  const lastDotIndex = value.lastIndexOf('.');

  if (lastCommaIndex >= 0 && lastDotIndex >= 0) {
    return lastCommaIndex > lastDotIndex ? ',' : '.';
  }

  if (lastCommaIndex >= 0) {
    return shouldTreatOnlySeparatorAsDecimal(value, ',') ? ',' : null;
  }

  if (lastDotIndex >= 0) {
    return shouldTreatOnlySeparatorAsDecimal(value, '.') ? '.' : null;
  }

  return null;
}

function shouldTreatOnlySeparatorAsDecimal(value: string, separator: ',' | '.'): boolean {
  const parts = value.split(separator);

  if (parts.length <= 1) {
    return false;
  }

  const lastPart = parts[parts.length - 1];

  return lastPart.length > 0 && lastPart.length !== 3;
}

function applyDecimalSeparator(value: string, decimalSeparator: ',' | '.' | null): string | null {
  if (decimalSeparator === null) {
    return value.replace(/[,.]/g, '');
  }

  const separatorIndex = value.lastIndexOf(decimalSeparator);

  if (separatorIndex < 0) {
    return value.replace(/[,.]/g, '');
  }

  const integerPart = value.slice(0, separatorIndex).replace(/[,.]/g, '');
  const decimalPart = value.slice(separatorIndex + 1);

  if (decimalPart === '' || /[,.]/.test(decimalPart)) {
    return null;
  }

  return `${integerPart}.${decimalPart}`;
}

function getColumnNames(rows: DataRow[]): string[] {
  const names = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      names.add(key);
    }
  }

  return [...names];
}

function isMissingValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function normalizeGroupValue(value: unknown): unknown {
  if (isMissingValue(value)) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return stableStringify(value);
  }

  return value;
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isMathStatisticsOperation(operation: unknown): operation is MathStatisticsOperation {
  return typeof operation === 'string' && SUPPORTED_OPERATIONS.includes(operation as MathStatisticsOperation);
}

function isGroupAggregation(aggregation: unknown): aggregation is GroupAggregation {
  return typeof aggregation === 'string' &&
    SUPPORTED_GROUP_AGGREGATIONS.includes(aggregation as GroupAggregation);
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

function round(value: number, precision = 6): number {
  return Number(value.toFixed(precision));
}

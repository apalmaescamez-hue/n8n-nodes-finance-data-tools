import { isValid, parseISO } from 'date-fns';
import Decimal from 'decimal.js';
import * as statistics from 'simple-statistics';
import { z } from 'zod';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AuditTrailEntry,
  ColumnProfile,
  DataProfilerError,
  DataProfilerWarning,
  DataRow,
  DatasetProfile,
  DuplicateRowGroup,
  InferredColumnType,
  NumericStatistics,
  OutlierProfile,
  ProfileDatasetOptions,
  ToolEnvelope,
} from './types';

const inputSchema = z.array(z.record(z.string(), z.unknown()));

const DEFAULT_OPTIONS: Required<ProfileDatasetOptions> = {
  treatEmptyStringAsNull: true,
  coerceNumericStrings: true,
  maxSamplesPerColumn: 5,
  maxDuplicateGroups: 20,
  maxOutlierExamples: 10,
};

export function profileDataset(
  input: unknown,
  options: ProfileDatasetOptions = {},
): ToolEnvelope<DatasetProfile> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const warnings: DataProfilerWarning[] = [];
  const errors: DataProfilerError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_received',
      message: 'Dataset profiling started.',
    }),
  ];

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

    return createFailureOutput<DatasetProfile>({
      operation: 'profileDataset',
      data: null,
      metadata: {
        rowCount: 0,
        columnCount: 0,
        generatedAt,
        startedAt,
      },
      warnings,
      errors,
      auditTrail: [
        ...auditTrail,
        createAuditTrailEvent({
          step: 'validation_failed',
          message: 'Input validation failed.',
        }),
      ],
    });
  }

  const rows = parsed.data;
  const columnNames = getColumnNames(rows);

  auditTrail.push(createAuditTrailEvent({
    step: 'schema_detected',
    message: 'Columns were collected from input rows.',
    details: {
      rowCount: rows.length,
      columnCount: columnNames.length,
    },
  }));

  const columns = columnNames.map((columnName) =>
    profileColumn(rows, columnName, resolvedOptions),
  );
  const duplicateRows = profileDuplicateRows(rows, resolvedOptions);
  const outliers = profileOutliers(rows, columns, resolvedOptions);
  const constantColumns = columns.filter((column) => column.constant).map((column) => column.name);

  addDataQualityWarnings({
    warnings,
    duplicateRows,
    outliers,
    constantColumns,
    columns,
  });

  const profile: DatasetProfile = {
    rowCount: rows.length,
    columnCount: columnNames.length,
    columns,
    duplicateRows,
    outliers,
    constantColumns,
    summary: {
      totalNullValues: columns.reduce((total, column) => total + column.nullCount, 0),
      totalDuplicateRows: duplicateRows.duplicateRowCount,
      totalOutliers: outliers.reduce((total, outlier) => total + outlier.count, 0),
      columnsWithNulls: columns.filter((column) => column.nullCount > 0).map((column) => column.name),
      numericColumns: columns
        .filter((column) => column.inferredType === 'number' || column.inferredType === 'integer')
        .map((column) => column.name),
    },
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'profile_completed',
    message: 'Dataset profiling completed.',
    details: {
      warnings: warnings.length,
      errors: errors.length,
    },
  }));

  return createSuccessOutput({
    operation: 'profileDataset',
    data: profile,
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

function getColumnNames(rows: DataRow[]): string[] {
  const names = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      names.add(key);
    }
  }

  return [...names];
}

function profileColumn(
  rows: DataRow[],
  columnName: string,
  options: Required<ProfileDatasetOptions>,
): ColumnProfile {
  const values = rows.map((row) => row[columnName]);
  const typeDistribution: Partial<Record<InferredColumnType, number>> = {};
  const nonNullValues: unknown[] = [];
  const uniqueValues = new Set<string>();
  const sampleValues: unknown[] = [];
  let nullCount = 0;

  for (const value of values) {
    if (isNullLike(value, options)) {
      nullCount += 1;
      typeDistribution.null = (typeDistribution.null ?? 0) + 1;
      continue;
    }

    const inferredType = inferValueType(value, options);
    typeDistribution[inferredType] = (typeDistribution[inferredType] ?? 0) + 1;
    nonNullValues.push(value);
    uniqueValues.add(stableStringify(normalizeForComparison(value, options)));

    if (sampleValues.length < options.maxSamplesPerColumn) {
      sampleValues.push(value);
    }
  }

  const inferredType = inferColumnType(typeDistribution);
  const nonNullCount = rows.length - nullCount;
  const numericValues = collectNumericValues(nonNullValues, options);
  const numericStatistics =
    numericValues.length > 0 &&
    numericValues.length === nonNullCount &&
    (inferredType === 'number' || inferredType === 'integer')
      ? calculateNumericStatistics(numericValues)
      : undefined;

  return {
    name: columnName,
    inferredType,
    nullCount,
    nullRatio: rows.length === 0 ? 0 : round(nullCount / rows.length),
    nonNullCount,
    cardinality: uniqueValues.size,
    constant: nonNullCount > 0 && uniqueValues.size <= 1,
    sampleValues,
    typeDistribution,
    numericStatistics,
  };
}

function inferColumnType(
  distribution: Partial<Record<InferredColumnType, number>>,
): InferredColumnType {
  const nonNullTypes = Object.entries(distribution)
    .filter(([type]) => type !== 'null')
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([type]) => type as InferredColumnType);

  if (nonNullTypes.length === 0) {
    return 'null';
  }

  const numericTypes = new Set<InferredColumnType>(['integer', 'number']);
  const onlyNumeric = nonNullTypes.every((type) => numericTypes.has(type));

  if (onlyNumeric) {
    return nonNullTypes.includes('number') ? 'number' : 'integer';
  }

  return nonNullTypes.length === 1 ? nonNullTypes[0] : 'mixed';
}

function inferValueType(value: unknown, options: Required<ProfileDatasetOptions>): InferredColumnType {
  if (isNullLike(value, options)) {
    return 'null';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? (Number.isInteger(value) ? 'integer' : 'number') : 'unknown';
  }

  if (typeof value === 'bigint') {
    return 'integer';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'unknown' : 'date';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (options.coerceNumericStrings && isNumericString(trimmed)) {
      return Number.isInteger(Number(trimmed)) ? 'integer' : 'number';
    }

    if (isBooleanString(trimmed)) {
      return 'boolean';
    }

    if (isIsoDateLikeString(trimmed)) {
      return 'date';
    }

    return 'string';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (isPlainObject(value)) {
    return 'object';
  }

  return 'unknown';
}

function isNullLike(value: unknown, options: Required<ProfileDatasetOptions>): boolean {
  return (
    value === null ||
    value === undefined ||
    (options.treatEmptyStringAsNull && typeof value === 'string' && value.trim() === '')
  );
}

function isNumericString(value: string): boolean {
  if (value === '') {
    return false;
  }

  return /^[-+]?(?:\d+|\d*\.\d+)(?:e[-+]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
}

function isBooleanString(value: string): boolean {
  return /^(true|false)$/i.test(value);
}

function isIsoDateLikeString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value)) {
    return false;
  }

  return isValid(parseISO(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function collectNumericValues(
  values: unknown[],
  options: Required<ProfileDatasetOptions>,
): number[] {
  return values
    .map((value) => toNumber(value, options))
    .filter((value): value is number => value !== null);
}

function toNumber(value: unknown, options: Required<ProfileDatasetOptions>): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (options.coerceNumericStrings && typeof value === 'string' && isNumericString(value.trim())) {
    return Number(value);
  }

  return null;
}

function calculateNumericStatistics(values: number[]): NumericStatistics {
  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total.plus(value), new Decimal(0));
  const q1 = statistics.quantileSorted(sorted, 0.25);
  const q3 = statistics.quantileSorted(sorted, 0.75);
  const variance = values.length > 1 ? statistics.variance(values) : 0;

  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(sum.div(values.length).toNumber()),
    median: round(statistics.medianSorted(sorted)),
    sum: round(sum.toNumber()),
    variance: round(variance),
    standardDeviation: round(values.length > 1 ? statistics.standardDeviation(values) : 0),
    q1: round(q1),
    q3: round(q3),
    iqr: round(q3 - q1),
  };
}

function profileDuplicateRows(
  rows: DataRow[],
  options: Required<ProfileDatasetOptions>,
): {
  duplicateRowCount: number;
  duplicateGroupCount: number;
  groups: DuplicateRowGroup[];
} {
  const rowIndexBySignature = new Map<string, number[]>();

  rows.forEach((row, rowIndex) => {
    const signature = stableStringify(normalizeForComparison(row, options));
    const indexes = rowIndexBySignature.get(signature) ?? [];
    indexes.push(rowIndex);
    rowIndexBySignature.set(signature, indexes);
  });

  const allGroups = [...rowIndexBySignature.values()]
    .filter((rowIndexes) => rowIndexes.length > 1)
    .map((rowIndexes) => ({
      firstRowIndex: rowIndexes[0],
      rowIndexes,
      count: rowIndexes.length,
    }));

  return {
    duplicateRowCount: allGroups.reduce((total, group) => total + group.count, 0),
    duplicateGroupCount: allGroups.length,
    groups: allGroups.slice(0, options.maxDuplicateGroups),
  };
}

function profileOutliers(
  rows: DataRow[],
  columns: ColumnProfile[],
  options: Required<ProfileDatasetOptions>,
): OutlierProfile[] {
  return columns
    .filter((column) => column.numericStatistics && column.numericStatistics.count >= 4)
    .map((column) => {
      const statisticsForColumn = column.numericStatistics as NumericStatistics;
      const lowerFence = statisticsForColumn.q1 - 1.5 * statisticsForColumn.iqr;
      const upperFence = statisticsForColumn.q3 + 1.5 * statisticsForColumn.iqr;
      const examples = rows
        .map((row, rowIndex) => ({
          rowIndex,
          value: toNumber(row[column.name], options),
        }))
        .filter(
          (entry): entry is { rowIndex: number; value: number } =>
            entry.value !== null && (entry.value < lowerFence || entry.value > upperFence),
        )
        .slice(0, options.maxOutlierExamples);

      return {
        column: column.name,
        method: 'iqr' as const,
        lowerFence: round(lowerFence),
        upperFence: round(upperFence),
        count: examples.length,
        examples,
      };
    })
    .filter((outlier) => outlier.count > 0);
}

function addDataQualityWarnings({
  warnings,
  duplicateRows,
  outliers,
  constantColumns,
  columns,
}: {
  warnings: DataProfilerWarning[];
  duplicateRows: { duplicateRowCount: number; duplicateGroupCount: number };
  outliers: OutlierProfile[];
  constantColumns: string[];
  columns: ColumnProfile[];
}): void {
  if (duplicateRows.duplicateGroupCount > 0) {
    warnings.push({
      code: 'DUPLICATE_ROWS',
      severity: 'warning',
      message: 'Duplicate rows were detected.',
      details: duplicateRows,
    });
  }

  if (outliers.length > 0) {
    warnings.push({
      code: 'NUMERIC_OUTLIERS',
      severity: 'warning',
      message: 'Numeric outliers were detected using the IQR method.',
      details: {
        columns: outliers.map((outlier) => outlier.column),
        totalOutliers: outliers.reduce((total, outlier) => total + outlier.count, 0),
      },
    });
  }

  if (constantColumns.length > 0) {
    warnings.push({
      code: 'CONSTANT_COLUMNS',
      severity: 'info',
      message: 'One or more columns have a single non-null value.',
      details: {
        columns: constantColumns,
      },
    });
  }

  for (const column of columns.filter((currentColumn) => currentColumn.nullRatio >= 0.5)) {
    warnings.push({
      code: 'HIGH_NULL_RATIO',
      severity: 'warning',
      message: `Column "${column.name}" has a high null ratio.`,
      field: column.name,
      details: {
        nullRatio: column.nullRatio,
        nullCount: column.nullCount,
      },
    });
  }
}

function normalizeForComparison(value: unknown, options: Required<ProfileDatasetOptions>): unknown {
  if (isNullLike(value, options)) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry, options));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizeForComparison(value[key], options);
        return normalized;
      }, {});
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

function round(value: number, precision = 6): number {
  return Number(value.toFixed(precision));
}

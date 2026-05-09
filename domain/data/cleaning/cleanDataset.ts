import { z } from 'zod';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AuditTrailEntry,
  CleanDatasetOptions,
  CleanDatasetResult,
  CleanDatasetSummary,
  DataCleanerError,
  DataCleanerWarning,
  DataRow,
  RemovedDuplicateRow,
  ResolvedCleanDatasetOptions,
  ToolEnvelope,
} from './types';

const inputSchema = z.array(z.record(z.string(), z.unknown()));

const DEFAULT_OPTIONS: ResolvedCleanDatasetOptions = {
  normalizeColumnNames: true,
  columnNameStyle: 'snakeCase',
  trimStrings: true,
  collapseWhitespace: true,
  stringCase: 'preserve',
  treatConfiguredNullsAsNull: true,
  nullValues: ['', 'NULL', 'null', 'N/A', 'NA', '-'],
  nullReplacement: null,
  cleanCurrencySymbols: false,
  convertEuropeanNumbers: false,
  numericColumns: [],
  removeEmptyColumns: false,
  removeDuplicates: false,
  deduplicateBy: 'fullRow',
  deduplicateKeys: [],
};

interface ColumnNameResolution {
  columnNameMap: Record<string, string>;
  reverseColumnNameMap: Record<string, string>;
}

interface RowWithSourceIndex {
  row: DataRow;
  rowIndex: number;
}

interface CleanValueContext {
  columnName: string;
  originalColumnName: string;
  rowIndex: number;
  options: ResolvedCleanDatasetOptions;
  summary: CleanDatasetSummary;
  warnings: DataCleanerWarning[];
}

interface ParsedNumber {
  parsed: boolean;
  value: number | null;
}

export function cleanDataset(
  input: unknown,
  options: CleanDatasetOptions = {},
): ToolEnvelope<CleanDatasetResult> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const resolvedOptions = resolveOptions(options);
  const warnings: DataCleanerWarning[] = [];
  const errors: DataCleanerError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_received',
      message: 'Dataset cleaning started.',
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

    return createFailureOutput<CleanDatasetResult>({
      operation: 'cleanDataset',
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
  const originalColumnNames = getColumnNames(rows);
  const columnResolution = resolveColumnNames(originalColumnNames, resolvedOptions, warnings);
  const summary = createInitialSummary(rows.length, originalColumnNames.length);

  auditTrail.push(createAuditTrailEvent({
    step: 'columns_normalized',
    message: 'Column names were resolved for the cleaned dataset.',
    details: {
      normalizeColumnNames: resolvedOptions.normalizeColumnNames,
      style: resolvedOptions.columnNameStyle,
      columnNameMap: columnResolution.columnNameMap,
    },
  }));

  let workingRows = rows.map<RowWithSourceIndex>((row, rowIndex) => ({
    row: cleanRow({
      row,
      rowIndex,
      originalColumnNames,
      columnResolution,
      options: resolvedOptions,
      summary,
      warnings,
    }),
    rowIndex,
  }));

  auditTrail.push(createAuditTrailEvent({
    step: 'values_cleaned',
    message: 'String, null, currency, and numeric cleaning rules were applied.',
    details: {
      trimmedValues: summary.trimmedValues,
      compactedWhitespaceValues: summary.compactedWhitespaceValues,
      normalizedStringCaseValues: summary.normalizedStringCaseValues,
      nullValuesReplaced: summary.nullValuesReplaced,
      currencySymbolsCleaned: summary.currencySymbolsCleaned,
      numericValuesConverted: summary.numericValuesConverted,
      unparseableNumericValues: summary.unparseableNumericValues,
    },
  }));

  const removedColumns = resolvedOptions.removeEmptyColumns
    ? removeEmptyColumns(workingRows, warnings)
    : [];
  summary.emptyColumnsRemoved = removedColumns.length;

  if (removedColumns.length > 0) {
    auditTrail.push(createAuditTrailEvent({
      step: 'empty_columns_removed',
      message: 'Columns with only null-like values were removed.',
      details: {
        columns: removedColumns,
      },
    }));
  }

  const removedDuplicateRows: RemovedDuplicateRow[] = [];

  if (resolvedOptions.removeDuplicates) {
    workingRows = deduplicateRows({
      workingRows,
      options: resolvedOptions,
      warnings,
      removedDuplicateRows,
    });
    summary.duplicateRowsRemoved = removedDuplicateRows.length;

    auditTrail.push(createAuditTrailEvent({
      step: 'duplicates_processed',
      message: 'Duplicate-row policy was applied.',
      details: {
        deduplicateBy: resolvedOptions.deduplicateBy,
        deduplicateKeys: resolvedOptions.deduplicateKeys,
        removedDuplicateRows,
      },
    }));
  }

  const cleanedRows = workingRows.map(({ row }) => row);
  const outputColumnNames = getColumnNames(cleanedRows);

  summary.outputRowCount = cleanedRows.length;
  summary.outputColumnCount = outputColumnNames.length;

  const result: CleanDatasetResult = {
    rows: cleanedRows,
    rowCount: cleanedRows.length,
    columnCount: outputColumnNames.length,
    columnNameMap: columnResolution.columnNameMap,
    removedColumns,
    removedDuplicateRows,
    summary,
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'cleaning_completed',
    message: 'Dataset cleaning completed.',
    details: {
      warnings: warnings.length,
      errors: errors.length,
      outputRowCount: result.rowCount,
      outputColumnCount: result.columnCount,
    },
  }));

  return createSuccessOutput({
    operation: 'cleanDataset',
    data: result,
    metadata: {
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      generatedAt,
      startedAt,
    },
    warnings,
    errors,
    auditTrail,
  });
}

function resolveOptions(options: CleanDatasetOptions): ResolvedCleanDatasetOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    nullValues: options.nullValues ?? DEFAULT_OPTIONS.nullValues,
    numericColumns: options.numericColumns ?? DEFAULT_OPTIONS.numericColumns,
    deduplicateKeys: options.deduplicateKeys ?? DEFAULT_OPTIONS.deduplicateKeys,
  };
}

function createInitialSummary(inputRowCount: number, inputColumnCount: number): CleanDatasetSummary {
  return {
    inputRowCount,
    outputRowCount: inputRowCount,
    inputColumnCount,
    outputColumnCount: inputColumnCount,
    trimmedValues: 0,
    compactedWhitespaceValues: 0,
    normalizedStringCaseValues: 0,
    nullValuesReplaced: 0,
    currencySymbolsCleaned: 0,
    numericValuesConverted: 0,
    unparseableNumericValues: 0,
    emptyColumnsRemoved: 0,
    duplicateRowsRemoved: 0,
  };
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

function resolveColumnNames(
  originalColumnNames: string[],
  options: ResolvedCleanDatasetOptions,
  warnings: DataCleanerWarning[],
): ColumnNameResolution {
  const columnNameMap: Record<string, string> = {};
  const reverseColumnNameMap: Record<string, string> = {};
  const usedNames = new Map<string, number>();

  for (const originalColumnName of originalColumnNames) {
    const baseName = options.normalizeColumnNames
      ? normalizeColumnName(originalColumnName, options.columnNameStyle)
      : originalColumnName;
    const usedCount = usedNames.get(baseName) ?? 0;
    const normalizedName = usedCount === 0 ? baseName : `${baseName}_${usedCount + 1}`;

    usedNames.set(baseName, usedCount + 1);
    columnNameMap[originalColumnName] = normalizedName;
    reverseColumnNameMap[normalizedName] = originalColumnName;

    if (usedCount > 0) {
      warnings.push({
        code: 'COLUMN_NAME_COLLISION',
        severity: 'warning',
        message: `Column "${originalColumnName}" normalized to an existing name and was suffixed.`,
        field: normalizedName,
        details: {
          originalColumnName,
          baseName,
          normalizedName,
        },
      });
    }
  }

  return { columnNameMap, reverseColumnNameMap };
}

function normalizeColumnName(columnName: string, style: ResolvedCleanDatasetOptions['columnNameStyle']): string {
  const words = columnName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return 'column';
  }

  if (style === 'camelCase') {
    return words
      .map((word, index) => {
        const lowered = word.toLowerCase();
        return index === 0 ? lowered : `${lowered[0].toUpperCase()}${lowered.slice(1)}`;
      })
      .join('');
  }

  if (style === 'lowerCase') {
    return words.join(' ').toLowerCase();
  }

  return words.join('_').toLowerCase();
}

function cleanRow({
  row,
  rowIndex,
  originalColumnNames,
  columnResolution,
  options,
  summary,
  warnings,
}: {
  row: DataRow;
  rowIndex: number;
  originalColumnNames: string[];
  columnResolution: ColumnNameResolution;
  options: ResolvedCleanDatasetOptions;
  summary: CleanDatasetSummary;
  warnings: DataCleanerWarning[];
}): DataRow {
  const cleanedRow: DataRow = {};

  for (const originalColumnName of originalColumnNames) {
    if (!Object.prototype.hasOwnProperty.call(row, originalColumnName)) {
      continue;
    }

    const columnName = columnResolution.columnNameMap[originalColumnName];
    cleanedRow[columnName] = cleanValue(row[originalColumnName], {
      columnName,
      originalColumnName,
      rowIndex,
      options,
      summary,
      warnings,
    });
  }

  return cleanedRow;
}

function cleanValue(value: unknown, context: CleanValueContext): unknown {
  const nullReplacement = getNullReplacement(value, context.options);

  if (nullReplacement.matched) {
    context.summary.nullValuesReplaced += 1;
    return nullReplacement.value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  let cleanedValue = value;

  if (context.options.trimStrings) {
    const trimmed = cleanedValue.trim();
    if (trimmed !== cleanedValue) {
      context.summary.trimmedValues += 1;
      cleanedValue = trimmed;
    }
  }

  if (context.options.collapseWhitespace) {
    const compacted = cleanedValue.replace(/\s+/g, ' ');
    if (compacted !== cleanedValue) {
      context.summary.compactedWhitespaceValues += 1;
      cleanedValue = compacted;
    }
  }

  const postStringCleanupNullReplacement = getNullReplacement(cleanedValue, context.options);

  if (postStringCleanupNullReplacement.matched) {
    context.summary.nullValuesReplaced += 1;
    return postStringCleanupNullReplacement.value;
  }

  if (context.options.cleanCurrencySymbols && shouldCleanCurrencyMarkers(cleanedValue, context)) {
    const withoutCurrency = stripCurrencyMarkers(cleanedValue).trim().replace(/\s+/g, ' ');

    if (withoutCurrency !== cleanedValue) {
      context.summary.currencySymbolsCleaned += 1;
      cleanedValue = withoutCurrency;
    }
  }

  const postCurrencyNullReplacement = getNullReplacement(cleanedValue, context.options);

  if (postCurrencyNullReplacement.matched) {
    context.summary.nullValuesReplaced += 1;
    return postCurrencyNullReplacement.value;
  }

  if (context.options.convertEuropeanNumbers && shouldAttemptNumericConversion(cleanedValue, context)) {
    const parsed = parseEuropeanNumber(cleanedValue);

    if (parsed.parsed) {
      context.summary.numericValuesConverted += 1;
      return parsed.value;
    }

    context.summary.unparseableNumericValues += 1;
    context.warnings.push({
      code: 'UNPARSEABLE_NUMERIC_VALUE',
      severity: 'warning',
      message: `Value in column "${context.columnName}" could not be parsed as a number.`,
      field: context.columnName,
      details: {
        rowIndex: context.rowIndex,
        originalColumnName: context.originalColumnName,
        value: cleanedValue,
      },
    });
  }

  if (context.options.stringCase !== 'preserve') {
    const normalizedCase =
      context.options.stringCase === 'lower' ? cleanedValue.toLowerCase() : cleanedValue.toUpperCase();

    if (normalizedCase !== cleanedValue) {
      context.summary.normalizedStringCaseValues += 1;
      cleanedValue = normalizedCase;
    }
  }

  return cleanedValue;
}

function getNullReplacement(
  value: unknown,
  options: ResolvedCleanDatasetOptions,
): { matched: boolean; value: unknown } {
  if (!options.treatConfiguredNullsAsNull) {
    return { matched: false, value };
  }

  if (value === null || value === undefined) {
    return { matched: true, value: options.nullReplacement };
  }

  if (typeof value !== 'string') {
    return { matched: false, value };
  }

  const normalizedValue = value.trim().toLowerCase();
  const nullValues = new Set(options.nullValues.map((entry) => entry.trim().toLowerCase()));

  return nullValues.has(normalizedValue)
    ? { matched: true, value: options.nullReplacement }
    : { matched: false, value };
}

function shouldCleanCurrencyMarkers(value: string, context: CleanValueContext): boolean {
  return hasDigit(value) || isConfiguredNumericColumn(context);
}

function stripCurrencyMarkers(value: string): string {
  return value
    .replace(/[\p{Sc}]/gu, '')
    .replace(/\b(?:EUR|USD|GBP|JPY|CHF|CAD|AUD)\b/giu, '')
    .trim();
}

function shouldAttemptNumericConversion(value: string, context: CleanValueContext): boolean {
  if (isConfiguredNumericColumn(context)) {
    return true;
  }

  const stripped = stripCurrencyMarkers(value).replace(/[\s'’]/g, '');

  return hasDigit(stripped) && /^[+-]?[\d.,]+$/.test(stripped);
}

function isConfiguredNumericColumn(context: CleanValueContext): boolean {
  if (context.options.numericColumns.length === 0) {
    return false;
  }

  const candidates = new Set(
    [
      context.columnName,
      context.originalColumnName,
      normalizeColumnName(context.originalColumnName, context.options.columnNameStyle),
    ].map((candidate) => candidate.trim().toLowerCase()),
  );

  return context.options.numericColumns
    .map((column) => column.trim().toLowerCase())
    .filter((column) => column.length > 0)
    .some((column) => candidates.has(column) || candidates.has(normalizeColumnName(column, context.options.columnNameStyle)));
}

function parseEuropeanNumber(value: string): ParsedNumber {
  const stripped = stripCurrencyMarkers(value).replace(/[\s'’]/g, '');

  if (stripped.length === 0 || !/^[+-]?[\d.,]+$/.test(stripped)) {
    return { parsed: false, value: null };
  }

  const sign = stripped.startsWith('-') || stripped.startsWith('+') ? stripped[0] : '';
  const unsigned = sign ? stripped.slice(1) : stripped;

  if (unsigned.length === 0) {
    return { parsed: false, value: null };
  }

  const commaCount = countOccurrences(unsigned, ',');
  const dotCount = countOccurrences(unsigned, '.');
  let normalized: string | null = null;

  if (commaCount > 0 && dotCount > 0) {
    normalized =
      unsigned.lastIndexOf(',') > unsigned.lastIndexOf('.')
        ? unsigned.replace(/\./g, '').replace(',', '.')
        : unsigned.replace(/,/g, '');
  } else if (commaCount > 0) {
    normalized = normalizeSingleSeparatorNumber(unsigned, ',');
  } else if (dotCount > 0) {
    normalized = normalizeSingleSeparatorNumber(unsigned, '.');
  } else {
    normalized = unsigned;
  }

  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    return { parsed: false, value: null };
  }

  const parsed = Number(`${sign}${normalized}`);

  return Number.isFinite(parsed) ? { parsed: true, value: parsed } : { parsed: false, value: null };
}

function normalizeSingleSeparatorNumber(value: string, separator: ',' | '.'): string | null {
  const escapedSeparator = separator === '.' ? '\\.' : separator;
  const groups = value.split(separator);

  if (groups.length === 2) {
    const [head, tail] = groups;

    if (tail.length === 3 && head.length > 0) {
      return `${head}${tail}`;
    }

    if (tail.length > 0) {
      return separator === ',' ? `${head}.${tail}` : value;
    }
  }

  const thousandsPattern = new RegExp(`^\\d{1,3}(?:${escapedSeparator}\\d{3})+$`);

  if (thousandsPattern.test(value)) {
    return value.replace(new RegExp(escapedSeparator, 'g'), '');
  }

  return null;
}

function countOccurrences(value: string, character: string): number {
  return [...value].filter((currentCharacter) => currentCharacter === character).length;
}

function hasDigit(value: string): boolean {
  return /\d/.test(value);
}

function removeEmptyColumns(
  workingRows: RowWithSourceIndex[],
  warnings: DataCleanerWarning[],
): string[] {
  const columnNames = getColumnNames(workingRows.map(({ row }) => row));
  const emptyColumns = columnNames.filter((columnName) =>
    workingRows.every(({ row }) => isEmptyCell(row[columnName])),
  );

  if (emptyColumns.length === 0) {
    return [];
  }

  for (const { row } of workingRows) {
    for (const columnName of emptyColumns) {
      delete row[columnName];
    }
  }

  warnings.push({
    code: 'EMPTY_COLUMNS_REMOVED',
    severity: 'info',
    message: 'One or more empty columns were removed.',
    details: {
      columns: emptyColumns,
      count: emptyColumns.length,
    },
  });

  return emptyColumns;
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function deduplicateRows({
  workingRows,
  options,
  warnings,
  removedDuplicateRows,
}: {
  workingRows: RowWithSourceIndex[];
  options: ResolvedCleanDatasetOptions;
  warnings: DataCleanerWarning[];
  removedDuplicateRows: RemovedDuplicateRow[];
}): RowWithSourceIndex[] {
  const availableColumns = new Set(getColumnNames(workingRows.map(({ row }) => row)));
  const keys = resolveDeduplicationKeys(options, availableColumns, warnings);

  if (options.deduplicateBy === 'keys' && keys.length === 0) {
    return workingRows;
  }

  const firstRowBySignature = new Map<string, RowWithSourceIndex>();
  const keptRows: RowWithSourceIndex[] = [];

  for (const currentRow of workingRows) {
    const signature = createDeduplicationSignature(currentRow.row, keys);
    const firstRow = firstRowBySignature.get(signature);

    if (firstRow) {
      removedDuplicateRows.push({
        rowIndex: currentRow.rowIndex,
        duplicateOfRowIndex: firstRow.rowIndex,
      });
      continue;
    }

    firstRowBySignature.set(signature, currentRow);
    keptRows.push(currentRow);
  }

  if (removedDuplicateRows.length > 0) {
    warnings.push({
      code: 'DUPLICATE_ROWS_REMOVED',
      severity: 'warning',
      message: 'Duplicate rows were removed according to the configured deduplication policy.',
      details: {
        duplicateRowsRemoved: removedDuplicateRows.length,
        deduplicateBy: options.deduplicateBy,
        deduplicateKeys: keys,
        removedDuplicateRows,
      },
    });
  }

  return keptRows;
}

function resolveDeduplicationKeys(
  options: ResolvedCleanDatasetOptions,
  availableColumns: Set<string>,
  warnings: DataCleanerWarning[],
): string[] {
  if (options.deduplicateBy === 'fullRow') {
    return [];
  }

  const requestedKeys = options.deduplicateKeys
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => normalizeColumnName(key, options.columnNameStyle));

  if (requestedKeys.length === 0) {
    warnings.push({
      code: 'DEDUPLICATION_KEYS_MISSING',
      severity: 'warning',
      message: 'Deduplication by keys was requested, but no keys were configured.',
    });

    return [];
  }

  const missingKeys = requestedKeys.filter((key) => !availableColumns.has(key));

  if (missingKeys.length > 0) {
    warnings.push({
      code: 'DEDUPLICATION_KEYS_NOT_FOUND',
      severity: 'warning',
      message: 'Some configured deduplication keys were not found in the cleaned dataset.',
      details: {
        missingKeys,
      },
    });
  }

  return requestedKeys.filter((key) => availableColumns.has(key));
}

function createDeduplicationSignature(row: DataRow, keys: string[]): string {
  if (keys.length === 0) {
    return stableStringify(normalizeForComparison(row));
  }

  return stableStringify(
    keys.reduce<Record<string, unknown>>((signature, key) => {
      signature[key] = normalizeForComparison(row[key]);
      return signature;
    }, {}),
  );
}

function normalizeForComparison(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizeForComparison(value[key]);
        return normalized;
      }, {});
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

import { format, isValid, parse, parseISO } from 'date-fns';
import Decimal from 'decimal.js';
import { z } from 'zod';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AuditTrailEntry,
  DataNormalizerError,
  DataNormalizerWarning,
  DataRow,
  NormalizeDatasetOptions,
  NormalizeDatasetResult,
  NormalizeDatasetSummary,
  PercentageOutputMode,
  ResolvedNormalizeDatasetOptions,
  ToolEnvelope,
} from './types';

const inputSchema = z.array(z.record(z.string(), z.unknown()));

const DEFAULT_OPTIONS: ResolvedNormalizeDatasetOptions = {
  addCurrencyColumn: true,
  accountingPeriodColumn: 'accountingPeriod',
  accountingPeriodDateColumn: '',
  amountColumns: [],
  categoryColumns: [],
  columnMapping: {},
  currencyColumn: 'currency',
  dateColumns: [],
  defaultCurrency: 'EUR',
  percentageColumns: [],
  percentageOutputMode: 'ratioDecimalString',
  renameColumns: {},
};

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'dd/MM/yyyy',
  'd/M/yyyy',
  'dd-MM-yyyy',
  'd-M-yyyy',
  'dd.MM.yyyy',
  'd.M.yyyy',
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  '€': 'EUR',
};

const CURRENCY_ALIASES: Record<string, string> = {
  AUD: 'AUD',
  BRL: 'BRL',
  CAD: 'CAD',
  CHF: 'CHF',
  CNY: 'CNY',
  DOLLAR: 'USD',
  EUR: 'EUR',
  EURO: 'EUR',
  GBP: 'GBP',
  JPY: 'JPY',
  MXN: 'MXN',
  NZD: 'NZD',
  USD: 'USD',
};

interface ColumnResolution {
  columnNameMap: Record<string, string>;
  finalColumnNames: Set<string>;
}

interface ResolvedTargetColumns {
  accountingPeriodColumn: string;
  accountingPeriodDateColumn: string;
  amountColumns: Set<string>;
  categoryColumns: Set<string>;
  currencyColumn: string;
  dateColumns: Set<string>;
  percentageColumns: Set<string>;
}

interface NormalizeRowContext {
  rowIndex: number;
  options: ResolvedNormalizeDatasetOptions;
  summary: NormalizeDatasetSummary;
  targets: ResolvedTargetColumns;
  warnings: DataNormalizerWarning[];
}

interface ParsedDecimalValue {
  parsed: boolean;
  value: Decimal | null;
}

interface ParsedDateValue {
  parsed: boolean;
  value: string | null;
}

interface NormalizedCurrencyValue {
  currency: string;
  usedDefault: boolean;
  parseable: boolean;
}

export function normalizeDataset(
  input: unknown,
  options: NormalizeDatasetOptions = {},
): ToolEnvelope<NormalizeDatasetResult> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const resolvedOptions = resolveOptions(options);
  const warnings: DataNormalizerWarning[] = [];
  const errors: DataNormalizerError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_received',
      message: 'Dataset normalization started.',
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

    return createFailureOutput<NormalizeDatasetResult>({
      operation: 'normalizeDataset',
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
  summary.mappedOrRenamedColumns = Object.entries(columnResolution.columnNameMap)
    .filter(([originalColumnName, finalColumnName]) => originalColumnName !== finalColumnName)
    .length;
  const targets = resolveTargetColumns(resolvedOptions, columnResolution, warnings);

  auditTrail.push(createAuditTrailEvent({
    step: 'columns_mapped',
    message: 'Column mapping and rename rules were resolved.',
    details: {
      columnNameMap: columnResolution.columnNameMap,
      mappedOrRenamedColumns: summary.mappedOrRenamedColumns,
    },
  }));

  const normalizedRows = rows.map((row, rowIndex) => normalizeRow({
    row,
    rowIndex,
    originalColumnNames,
    columnResolution,
    context: {
      rowIndex,
      options: resolvedOptions,
      summary,
      targets,
      warnings,
    },
  }));
  const outputColumnNames = getColumnNames(normalizedRows);

  summary.outputRowCount = normalizedRows.length;
  summary.outputColumnCount = outputColumnNames.length;

  auditTrail.push(createAuditTrailEvent({
    step: 'values_normalized',
    message: 'Amounts, dates, percentages, currency, accounting periods, and categories were normalized.',
    details: {
      amountValuesNormalized: summary.amountValuesNormalized,
      dateValuesNormalized: summary.dateValuesNormalized,
      percentageValuesNormalized: summary.percentageValuesNormalized,
      currencyValuesNormalized: summary.currencyValuesNormalized,
      accountingPeriodsGenerated: summary.accountingPeriodsGenerated,
      categoryValuesNormalized: summary.categoryValuesNormalized,
    },
  }));

  const result: NormalizeDatasetResult = {
    rows: normalizedRows,
    rowCount: normalizedRows.length,
    columnCount: outputColumnNames.length,
    columnNameMap: columnResolution.columnNameMap,
    summary,
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'normalization_completed',
    message: 'Dataset normalization completed.',
    details: {
      warnings: warnings.length,
      errors: errors.length,
      outputRowCount: result.rowCount,
      outputColumnCount: result.columnCount,
    },
  }));

  return createSuccessOutput({
    operation: 'normalizeDataset',
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

function resolveOptions(options: NormalizeDatasetOptions): ResolvedNormalizeDatasetOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    accountingPeriodColumn: cleanConfiguredColumnName(
      options.accountingPeriodColumn,
      DEFAULT_OPTIONS.accountingPeriodColumn,
    ),
    accountingPeriodDateColumn: cleanConfiguredColumnName(
      options.accountingPeriodDateColumn,
      DEFAULT_OPTIONS.accountingPeriodDateColumn,
    ),
    amountColumns: normalizeStringList(options.amountColumns ?? DEFAULT_OPTIONS.amountColumns),
    categoryColumns: normalizeStringList(options.categoryColumns ?? DEFAULT_OPTIONS.categoryColumns),
    columnMapping: normalizeColumnMapping(options.columnMapping ?? DEFAULT_OPTIONS.columnMapping),
    currencyColumn: cleanConfiguredColumnName(options.currencyColumn, DEFAULT_OPTIONS.currencyColumn),
    dateColumns: normalizeStringList(options.dateColumns ?? DEFAULT_OPTIONS.dateColumns),
    defaultCurrency: normalizeConfiguredDefaultCurrency(options.defaultCurrency),
    percentageColumns: normalizeStringList(options.percentageColumns ?? DEFAULT_OPTIONS.percentageColumns),
    percentageOutputMode: options.percentageOutputMode ?? DEFAULT_OPTIONS.percentageOutputMode,
    renameColumns: normalizeColumnMapping(options.renameColumns ?? DEFAULT_OPTIONS.renameColumns),
  };
}

function createInitialSummary(inputRowCount: number, inputColumnCount: number): NormalizeDatasetSummary {
  return {
    inputRowCount,
    outputRowCount: inputRowCount,
    inputColumnCount,
    outputColumnCount: inputColumnCount,
    mappedOrRenamedColumns: 0,
    amountValuesNormalized: 0,
    unparseableAmountValues: 0,
    dateValuesNormalized: 0,
    unparseableDateValues: 0,
    percentageValuesNormalized: 0,
    unparseablePercentageValues: 0,
    currencyValuesNormalized: 0,
    defaultCurrencyValuesApplied: 0,
    accountingPeriodsGenerated: 0,
    unparseableAccountingPeriodValues: 0,
    categoryValuesNormalized: 0,
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
  options: ResolvedNormalizeDatasetOptions,
  warnings: DataNormalizerWarning[],
): ColumnResolution {
  const columnNameMap: Record<string, string> = {};
  const usedNames = new Map<string, number>();

  for (const originalColumnName of originalColumnNames) {
    const finalColumnName = getMappedColumnName(originalColumnName, options);
    const usedCount = usedNames.get(finalColumnName) ?? 0;
    const uniqueColumnName = usedCount === 0 ? finalColumnName : `${finalColumnName}_${usedCount + 1}`;

    usedNames.set(finalColumnName, usedCount + 1);
    columnNameMap[originalColumnName] = uniqueColumnName;

    if (usedCount > 0) {
      warnings.push({
        code: 'COLUMN_NAME_COLLISION',
        severity: 'warning',
        message: `Column "${originalColumnName}" mapped to an existing target and was suffixed.`,
        field: uniqueColumnName,
        details: {
          originalColumnName,
          requestedColumnName: finalColumnName,
          finalColumnName: uniqueColumnName,
        },
      });
    }
  }

  return {
    columnNameMap,
    finalColumnNames: new Set(Object.values(columnNameMap)),
  };
}

function getMappedColumnName(
  originalColumnName: string,
  options: ResolvedNormalizeDatasetOptions,
): string {
  const mappedColumnName = options.columnMapping[originalColumnName] ?? originalColumnName;
  const renamedColumnName = options.renameColumns[mappedColumnName] ?? options.renameColumns[originalColumnName];
  const targetColumnName = cleanConfiguredColumnName(renamedColumnName ?? mappedColumnName, originalColumnName);

  return targetColumnName;
}

function resolveTargetColumns(
  options: ResolvedNormalizeDatasetOptions,
  columnResolution: ColumnResolution,
  warnings: DataNormalizerWarning[],
): ResolvedTargetColumns {
  return {
    accountingPeriodColumn: resolveColumnReference(
      options.accountingPeriodColumn,
      columnResolution,
    ),
    accountingPeriodDateColumn: resolveColumnReference(
      options.accountingPeriodDateColumn,
      columnResolution,
    ),
    amountColumns: resolveConfiguredColumnSet(
      'amount',
      options.amountColumns,
      columnResolution,
      warnings,
    ),
    categoryColumns: resolveConfiguredColumnSet(
      'category',
      options.categoryColumns,
      columnResolution,
      warnings,
    ),
    currencyColumn: resolveColumnReference(options.currencyColumn, columnResolution),
    dateColumns: resolveConfiguredColumnSet(
      'date',
      options.dateColumns,
      columnResolution,
      warnings,
    ),
    percentageColumns: resolveConfiguredColumnSet(
      'percentage',
      options.percentageColumns,
      columnResolution,
      warnings,
    ),
  };
}

function resolveConfiguredColumnSet(
  kind: string,
  configuredColumns: string[],
  columnResolution: ColumnResolution,
  warnings: DataNormalizerWarning[],
): Set<string> {
  const resolvedColumns = new Set<string>();
  const missingColumns: string[] = [];

  for (const configuredColumn of configuredColumns) {
    const resolvedColumn = resolveColumnReference(configuredColumn, columnResolution);

    if (!columnResolution.finalColumnNames.has(resolvedColumn)) {
      missingColumns.push(configuredColumn);
      continue;
    }

    resolvedColumns.add(resolvedColumn);
  }

  if (missingColumns.length > 0) {
    warnings.push({
      code: 'CONFIGURED_COLUMNS_NOT_FOUND',
      severity: 'warning',
      message: `Some configured ${kind} columns were not found in the normalized dataset.`,
      details: {
        kind,
        missingColumns,
      },
    });
  }

  return resolvedColumns;
}

function resolveColumnReference(
  columnName: string,
  columnResolution: ColumnResolution,
): string {
  if (columnName === '') {
    return '';
  }

  return columnResolution.columnNameMap[columnName] ?? columnName;
}

function normalizeRow({
  row,
  rowIndex,
  originalColumnNames,
  columnResolution,
  context,
}: {
  row: DataRow;
  rowIndex: number;
  originalColumnNames: string[];
  columnResolution: ColumnResolution;
  context: NormalizeRowContext;
}): DataRow {
  const normalizedRow: DataRow = {};

  for (const originalColumnName of originalColumnNames) {
    if (!Object.prototype.hasOwnProperty.call(row, originalColumnName)) {
      continue;
    }

    const finalColumnName = columnResolution.columnNameMap[originalColumnName];
    normalizedRow[finalColumnName] = normalizeValue(row[originalColumnName], finalColumnName, {
      ...context,
      rowIndex,
    });
  }

  applyCurrencyNormalization(normalizedRow, context);
  applyAccountingPeriod(normalizedRow, context);

  return normalizedRow;
}

function normalizeValue(
  value: unknown,
  columnName: string,
  context: NormalizeRowContext,
): unknown {
  let normalizedValue = value;

  if (context.targets.amountColumns.has(columnName)) {
    normalizedValue = normalizeAmountValue(normalizedValue, columnName, context);
  }

  if (context.targets.dateColumns.has(columnName)) {
    normalizedValue = normalizeDateValue(normalizedValue, columnName, context);
  }

  if (context.targets.percentageColumns.has(columnName)) {
    normalizedValue = normalizePercentageValue(normalizedValue, columnName, context);
  }

  if (context.targets.categoryColumns.has(columnName)) {
    normalizedValue = normalizeCategoryValue(normalizedValue, columnName, context);
  }

  return normalizedValue;
}

function normalizeAmountValue(
  value: unknown,
  columnName: string,
  context: NormalizeRowContext,
): unknown {
  if (isBlankLike(value)) {
    return value;
  }

  const parsed = parseDecimalValue(value);

  if (parsed.parsed && parsed.value !== null) {
    context.summary.amountValuesNormalized += 1;
    return toDecimalString(parsed.value);
  }

  context.summary.unparseableAmountValues += 1;
  context.warnings.push({
    code: 'UNPARSEABLE_AMOUNT_VALUE',
    severity: 'warning',
    message: `Value in column "${columnName}" could not be parsed as an amount.`,
    field: columnName,
    details: {
      rowIndex: context.rowIndex,
      value,
    },
  });

  return value;
}

function normalizeDateValue(
  value: unknown,
  columnName: string,
  context: NormalizeRowContext,
): unknown {
  if (isBlankLike(value)) {
    return value;
  }

  const parsed = parseDateValue(value);

  if (parsed.parsed && parsed.value !== null) {
    context.summary.dateValuesNormalized += 1;
    return parsed.value;
  }

  context.summary.unparseableDateValues += 1;
  context.warnings.push({
    code: 'UNPARSEABLE_DATE_VALUE',
    severity: 'warning',
    message: `Value in column "${columnName}" could not be parsed as a date.`,
    field: columnName,
    details: {
      rowIndex: context.rowIndex,
      value,
    },
  });

  return value;
}

function normalizePercentageValue(
  value: unknown,
  columnName: string,
  context: NormalizeRowContext,
): unknown {
  if (isBlankLike(value)) {
    return value;
  }

  const parsed = parsePercentageValue(value, context.options.percentageOutputMode);

  if (parsed !== null) {
    context.summary.percentageValuesNormalized += 1;
    return parsed;
  }

  context.summary.unparseablePercentageValues += 1;
  context.warnings.push({
    code: 'UNPARSEABLE_PERCENTAGE_VALUE',
    severity: 'warning',
    message: `Value in column "${columnName}" could not be parsed as a percentage.`,
    field: columnName,
    details: {
      rowIndex: context.rowIndex,
      value,
    },
  });

  return value;
}

function normalizeCategoryValue(
  value: unknown,
  columnName: string,
  context: NormalizeRowContext,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedValue = compactWhitespace(value);

  if (normalizedValue !== value) {
    context.summary.categoryValuesNormalized += 1;
    context.warnings.push({
      code: 'CATEGORY_VALUE_NORMALIZED',
      severity: 'info',
      message: `Whitespace was normalized in category column "${columnName}".`,
      field: columnName,
      details: {
        rowIndex: context.rowIndex,
      },
    });
  }

  return normalizedValue;
}

function applyCurrencyNormalization(
  row: DataRow,
  context: NormalizeRowContext,
): void {
  if (!context.options.addCurrencyColumn) {
    return;
  }

  const currencyColumn = context.targets.currencyColumn;
  const originalValue = row[currencyColumn];
  const normalizedCurrency = normalizeCurrencyValue(originalValue, context.options.defaultCurrency);

  row[currencyColumn] = normalizedCurrency.currency;
  context.summary.currencyValuesNormalized += 1;

  if (normalizedCurrency.usedDefault) {
    context.summary.defaultCurrencyValuesApplied += 1;
  }

  if (!normalizedCurrency.parseable && !isBlankLike(originalValue)) {
    context.warnings.push({
      code: 'UNPARSEABLE_CURRENCY_VALUE',
      severity: 'warning',
      message: `Value in column "${currencyColumn}" could not be parsed as an ISO currency code.`,
      field: currencyColumn,
      details: {
        rowIndex: context.rowIndex,
        value: originalValue,
        defaultCurrency: context.options.defaultCurrency,
      },
    });
  }
}

function applyAccountingPeriod(row: DataRow, context: NormalizeRowContext): void {
  const dateColumn = context.targets.accountingPeriodDateColumn;

  if (dateColumn === '') {
    return;
  }

  const dateValue = row[dateColumn];

  if (isBlankLike(dateValue)) {
    return;
  }

  const parsed = parseDateValue(dateValue);

  if (parsed.parsed && parsed.value !== null) {
    row[context.targets.accountingPeriodColumn] = parsed.value.slice(0, 7);
    context.summary.accountingPeriodsGenerated += 1;
    return;
  }

  context.summary.unparseableAccountingPeriodValues += 1;
  context.warnings.push({
    code: 'UNPARSEABLE_ACCOUNTING_PERIOD_DATE',
    severity: 'warning',
    message: `Value in column "${dateColumn}" could not be parsed for accounting period generation.`,
    field: dateColumn,
    details: {
      rowIndex: context.rowIndex,
      value: dateValue,
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

function parseDateValue(value: unknown): ParsedDateValue {
  if (value instanceof Date) {
    return isValid(value)
      ? { parsed: true, value: format(value, 'yyyy-MM-dd') }
      : { parsed: false, value: null };
  }

  if (typeof value !== 'string') {
    return { parsed: false, value: null };
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return { parsed: false, value: null };
  }

  const isoCandidate = parseISO(trimmed);

  if (isValid(isoCandidate) && /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(trimmed)) {
    return { parsed: true, value: format(isoCandidate, 'yyyy-MM-dd') };
  }

  for (const dateFormat of DATE_FORMATS) {
    const parsed = parse(trimmed, dateFormat, new Date(0));

    if (isValid(parsed) && format(parsed, dateFormat) === trimmed) {
      return { parsed: true, value: format(parsed, 'yyyy-MM-dd') };
    }
  }

  return { parsed: false, value: null };
}

function parsePercentageValue(
  value: unknown,
  outputMode: PercentageOutputMode,
): string | null {
  const hadPercentSign = typeof value === 'string' && value.includes('%');
  const sourceValue = typeof value === 'string' ? value.replace(/%/g, '') : value;
  const parsed = parseDecimalValue(sourceValue);

  if (!parsed.parsed || parsed.value === null) {
    return null;
  }

  const absoluteValue = parsed.value.abs();
  const shouldScaleFromPercent = hadPercentSign || absoluteValue.gt(1);
  const ratioValue = shouldScaleFromPercent ? parsed.value.div(100) : parsed.value;

  if (outputMode === 'ratioDecimalString') {
    return toDecimalString(ratioValue);
  }

  const percentValue = shouldScaleFromPercent ? parsed.value : parsed.value.mul(100);

  return `${toDecimalString(percentValue)}%`;
}

function normalizeCurrencyValue(value: unknown, defaultCurrency: string): NormalizedCurrencyValue {
  if (isBlankLike(value)) {
    return {
      currency: defaultCurrency,
      parseable: true,
      usedDefault: true,
    };
  }

  const normalized = String(value).normalize('NFKC').trim().toUpperCase();
  const compacted = normalized.replace(/\s+/g, ' ');
  const symbolCurrency = CURRENCY_SYMBOLS[compacted];

  if (symbolCurrency !== undefined) {
    return {
      currency: symbolCurrency,
      parseable: true,
      usedDefault: false,
    };
  }

  const alphaOnly = compacted.replace(/[^A-Z]/g, '');
  const aliasedCurrency = CURRENCY_ALIASES[alphaOnly];

  if (aliasedCurrency !== undefined) {
    return {
      currency: aliasedCurrency,
      parseable: true,
      usedDefault: false,
    };
  }

  if (/^[A-Z]{3}$/.test(alphaOnly)) {
    return {
      currency: alphaOnly,
      parseable: true,
      usedDefault: false,
    };
  }

  return {
    currency: defaultCurrency,
    parseable: false,
    usedDefault: true,
  };
}

function normalizeColumnMapping(mapping: Record<string, string>): Record<string, string> {
  return Object.entries(mapping).reduce<Record<string, string>>((normalized, [source, target]) => {
    const cleanSource = source.trim();
    const cleanTarget = String(target).trim();

    if (cleanSource !== '' && cleanTarget !== '') {
      normalized[cleanSource] = cleanTarget;
    }

    return normalized;
  }, {});
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function cleanConfiguredColumnName(value: string | undefined, fallback: string): string {
  const cleanValue = value?.trim() ?? '';

  return cleanValue === '' ? fallback : cleanValue;
}

function normalizeConfiguredDefaultCurrency(value: string | undefined): string {
  const normalized = normalizeCurrencyValue(value, DEFAULT_OPTIONS.defaultCurrency);

  return normalized.currency;
}

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isBlankLike(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function toDecimalString(value: Decimal): string {
  return value.toString();
}

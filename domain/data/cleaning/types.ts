import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';

export type Severity = NodeSeverity;

export type DataRow = Record<string, unknown>;

export type ColumnNameStyle = 'snakeCase' | 'camelCase' | 'lowerCase';

export type StringCaseMode = 'preserve' | 'lower' | 'upper';

export type DeduplicateBy = 'fullRow' | 'keys';

export type DataCleanerWarning = NodeWarning;

export type DataCleanerError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type CleanerMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, CleanerMetadata>;

export interface RemovedDuplicateRow {
  rowIndex: number;
  duplicateOfRowIndex: number;
}

export interface CleanDatasetSummary {
  inputRowCount: number;
  outputRowCount: number;
  inputColumnCount: number;
  outputColumnCount: number;
  trimmedValues: number;
  compactedWhitespaceValues: number;
  normalizedStringCaseValues: number;
  nullValuesReplaced: number;
  currencySymbolsCleaned: number;
  numericValuesConverted: number;
  unparseableNumericValues: number;
  emptyColumnsRemoved: number;
  duplicateRowsRemoved: number;
}

export interface CleanDatasetResult {
  rows: DataRow[];
  rowCount: number;
  columnCount: number;
  columnNameMap: Record<string, string>;
  removedColumns: string[];
  removedDuplicateRows: RemovedDuplicateRow[];
  summary: CleanDatasetSummary;
}

export interface CleanDatasetOptions {
  normalizeColumnNames?: boolean;
  columnNameStyle?: ColumnNameStyle;
  trimStrings?: boolean;
  collapseWhitespace?: boolean;
  stringCase?: StringCaseMode;
  treatConfiguredNullsAsNull?: boolean;
  nullValues?: string[];
  nullReplacement?: string | number | boolean | null;
  cleanCurrencySymbols?: boolean;
  convertEuropeanNumbers?: boolean;
  numericColumns?: string[];
  removeEmptyColumns?: boolean;
  removeDuplicates?: boolean;
  deduplicateBy?: DeduplicateBy;
  deduplicateKeys?: string[];
}

export interface ResolvedCleanDatasetOptions {
  normalizeColumnNames: boolean;
  columnNameStyle: ColumnNameStyle;
  trimStrings: boolean;
  collapseWhitespace: boolean;
  stringCase: StringCaseMode;
  treatConfiguredNullsAsNull: boolean;
  nullValues: string[];
  nullReplacement: string | number | boolean | null;
  cleanCurrencySymbols: boolean;
  convertEuropeanNumbers: boolean;
  numericColumns: string[];
  removeEmptyColumns: boolean;
  removeDuplicates: boolean;
  deduplicateBy: DeduplicateBy;
  deduplicateKeys: string[];
}

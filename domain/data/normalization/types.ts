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

export type PercentageOutputMode = 'percentString' | 'ratioDecimalString';

export type DataNormalizerWarning = NodeWarning;

export type DataNormalizerError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type NormalizerMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, NormalizerMetadata>;

export interface NormalizeDatasetSummary {
  inputRowCount: number;
  outputRowCount: number;
  inputColumnCount: number;
  outputColumnCount: number;
  mappedOrRenamedColumns: number;
  amountValuesNormalized: number;
  unparseableAmountValues: number;
  dateValuesNormalized: number;
  unparseableDateValues: number;
  percentageValuesNormalized: number;
  unparseablePercentageValues: number;
  currencyValuesNormalized: number;
  defaultCurrencyValuesApplied: number;
  accountingPeriodsGenerated: number;
  unparseableAccountingPeriodValues: number;
  categoryValuesNormalized: number;
}

export interface NormalizeDatasetResult {
  rows: DataRow[];
  rowCount: number;
  columnCount: number;
  columnNameMap: Record<string, string>;
  summary: NormalizeDatasetSummary;
}

export interface NormalizeDatasetOptions {
  addCurrencyColumn?: boolean;
  accountingPeriodColumn?: string;
  accountingPeriodDateColumn?: string;
  amountColumns?: string[];
  categoryColumns?: string[];
  columnMapping?: Record<string, string>;
  currencyColumn?: string;
  dateColumns?: string[];
  defaultCurrency?: string;
  percentageColumns?: string[];
  percentageOutputMode?: PercentageOutputMode;
  renameColumns?: Record<string, string>;
}

export interface ResolvedNormalizeDatasetOptions {
  addCurrencyColumn: boolean;
  accountingPeriodColumn: string;
  accountingPeriodDateColumn: string;
  amountColumns: string[];
  categoryColumns: string[];
  columnMapping: Record<string, string>;
  currencyColumn: string;
  dateColumns: string[];
  defaultCurrency: string;
  percentageColumns: string[];
  percentageOutputMode: PercentageOutputMode;
  renameColumns: Record<string, string>;
}

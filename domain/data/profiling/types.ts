import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';

export type Severity = NodeSeverity;

export type InferredColumnType =
  | 'null'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'string'
  | 'array'
  | 'object'
  | 'mixed'
  | 'unknown';

export type DataProfilerWarning = NodeWarning;

export type DataProfilerError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type ProfilerMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, ProfilerMetadata>;

export interface NumericStatistics {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  sum: number;
  variance: number;
  standardDeviation: number;
  q1: number;
  q3: number;
  iqr: number;
}

export interface ColumnProfile {
  name: string;
  inferredType: InferredColumnType;
  nullCount: number;
  nullRatio: number;
  nonNullCount: number;
  cardinality: number;
  constant: boolean;
  sampleValues: unknown[];
  typeDistribution: Partial<Record<InferredColumnType, number>>;
  numericStatistics?: NumericStatistics;
}

export interface DuplicateRowGroup {
  firstRowIndex: number;
  rowIndexes: number[];
  count: number;
}

export interface DuplicateRowsProfile {
  duplicateRowCount: number;
  duplicateGroupCount: number;
  groups: DuplicateRowGroup[];
}

export interface OutlierExample {
  rowIndex: number;
  value: number;
}

export interface OutlierProfile {
  column: string;
  method: 'iqr';
  lowerFence: number;
  upperFence: number;
  count: number;
  examples: OutlierExample[];
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  duplicateRows: DuplicateRowsProfile;
  outliers: OutlierProfile[];
  constantColumns: string[];
  summary: {
    totalNullValues: number;
    totalDuplicateRows: number;
    totalOutliers: number;
    columnsWithNulls: string[];
    numericColumns: string[];
  };
}

export interface ProfileDatasetOptions {
  treatEmptyStringAsNull?: boolean;
  coerceNumericStrings?: boolean;
  maxSamplesPerColumn?: number;
  maxDuplicateGroups?: number;
  maxOutlierExamples?: number;
}

export type DataRow = Record<string, unknown>;

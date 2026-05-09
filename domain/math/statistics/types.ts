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

export type MathStatisticsOperation =
  | 'summary_statistics'
  | 'percentile'
  | 'correlation'
  | 'growth_rate'
  | 'cagr'
  | 'z_score'
  | 'outliers_iqr'
  | 'group_aggregate';

export type GrowthRateMode = 'first_last' | 'columns';

export type GroupAggregation = 'count' | 'sum' | 'mean' | 'min' | 'max';

export type MathStatisticsWarning = NodeWarning;

export type MathStatisticsError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type MathStatisticsMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, MathStatisticsMetadata>;

export interface CalculateStatisticsOptions {
  operation: MathStatisticsOperation;
  valueColumn?: string;
  secondaryValueColumn?: string;
  groupColumn?: string;
  percentile?: number;
  growthMode?: GrowthRateMode;
  cagrPeriods?: number | string;
  resultColumn?: string;
  aggregations?: GroupAggregation[];
}

export interface SummaryStatistics {
  count: number;
  sum: string;
  mean: string;
  median: string;
  min: string;
  max: string;
  variance: number;
  standardDeviation: number;
}

export interface SummaryStatisticsData {
  column: string;
  ignoredCount: number;
  statistics: SummaryStatistics;
}

export interface PercentileData {
  column: string;
  percentile: number;
  value: number | null;
  validCount: number;
  ignoredCount: number;
  limitation: string;
}

export interface CorrelationData {
  xColumn: string;
  yColumn: string;
  method: 'pearson';
  correlation: number | null;
  validPairCount: number;
  ignoredPairCount: number;
}

export interface GrowthRatePoint {
  rowIndex?: number;
  startValue: string;
  endValue: string;
  growthRate: string | null;
  growthRatePercent: string | null;
}

export interface GrowthRateData {
  mode: GrowthRateMode;
  column?: string;
  startColumn?: string;
  endColumn?: string;
  validCount: number;
  ignoredCount: number;
  divisionByZeroCount: number;
  result: GrowthRatePoint | null;
  rowResults: GrowthRatePoint[];
}

export interface CagrPoint {
  rowIndex: number;
  startValue: string;
  endValue: string;
  periods: string;
  cagr: string | null;
  cagrPercent: string | null;
}

export interface CagrData {
  startColumn: string;
  endColumn: string;
  periods: string;
  validPairCount: number;
  ignoredPairCount: number;
  nonPositiveStartCount: number;
  rowResults: CagrPoint[];
}

export interface ZScoreRow {
  rowIndex: number;
  value: string | null;
  zScore: number | null;
}

export interface ZScoreData {
  column: string;
  resultColumn: string;
  validCount: number;
  ignoredCount: number;
  mean: string | null;
  standardDeviation: number;
  scores: ZScoreRow[];
  rows: DataRow[];
}

export interface OutlierIqrExample {
  rowIndex: number;
  value: string;
  numericValue: number;
}

export interface OutliersIqrData {
  column: string;
  method: 'iqr';
  validCount: number;
  ignoredCount: number;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  lowerFence: number | null;
  upperFence: number | null;
  count: number;
  outliers: OutlierIqrExample[];
  limitation: string;
}

export interface GroupAggregateEntry {
  groupValue: unknown;
  rowCount: number;
  validValueCount: number;
  ignoredValueCount: number;
  count?: number;
  sum?: string | null;
  mean?: string | null;
  min?: string | null;
  max?: string | null;
}

export interface GroupAggregateData {
  groupColumn: string;
  valueColumn?: string;
  aggregations: GroupAggregation[];
  groupCount: number;
  ignoredCount: number;
  groups: GroupAggregateEntry[];
}

export type CalculateStatisticsResult =
  | SummaryStatisticsData
  | PercentileData
  | CorrelationData
  | GrowthRateData
  | CagrData
  | ZScoreData
  | OutliersIqrData
  | GroupAggregateData;

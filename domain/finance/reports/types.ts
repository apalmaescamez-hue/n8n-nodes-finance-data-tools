import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';

export type Severity = NodeSeverity;

export type FinancialReportOperation = 'build_financial_report';

export type FinancialReportType =
  | 'ai_agent_report'
  | 'balance_sheet'
  | 'cash_summary'
  | 'dashboard_json'
  | 'executive_summary'
  | 'kpi_table'
  | 'profit_and_loss';

export type DecimalInput = string | number | bigint;

export type ReportMetricUnit = 'count' | 'currency' | 'decimal' | 'percentage' | 'text';

export interface FinancialReportPeriod {
  end?: string;
  label?: string;
  start?: string;
}

export interface FinancialReportInput {
  currency?: string;
  period?: FinancialReportPeriod | string;
  profitAndLoss?: Record<string, unknown>;
  balanceSheet?: Record<string, unknown>;
  cashFlow?: Record<string, unknown>;
  kpis?: Record<string, unknown> | FinancialReportKpiInput[];
  ratios?: Record<string, unknown>;
}

export interface FinancialReportKpiInput {
  key?: string;
  label?: string;
  unit?: ReportMetricUnit | string;
  value?: unknown;
}

export interface BuildFinancialReportOptions {
  operation?: FinancialReportOperation;
  reportType?: FinancialReportType;
  currency?: string;
  reportingPeriodLabel?: string;
  includeDashboardData?: boolean;
  includeSourceData?: boolean;
}

export type FinancialReportWarning = NodeWarning;

export type FinancialReportError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type FinancialReportMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, FinancialReportMetadata>;

export interface ReportMetric {
  key: string;
  label: string;
  value: string | null;
  unit: ReportMetricUnit;
  category: string;
  details?: Record<string, unknown>;
}

export interface ReportRow {
  key: string;
  label: string;
  value: string | null;
  unit: ReportMetricUnit;
  level?: number;
  source?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  rows: ReportRow[];
  narrative: string[];
  warnings: string[];
}

export interface DashboardCard {
  key: string;
  title: string;
  value: string | null;
  unit: ReportMetricUnit;
  sentiment: 'negative' | 'neutral' | 'positive' | 'warning';
}

export interface DashboardData {
  cards: DashboardCard[];
  tables: Array<{
    id: string;
    title: string;
    rows: ReportRow[];
  }>;
}

export interface AgentInstructions {
  canSummarize: boolean;
  mustMentionWarnings: boolean;
  mustNotOverstateResults: boolean;
  recommendedPrompt: string;
}

export interface FinancialReportData {
  reportType: FinancialReportType;
  currency: string;
  period: FinancialReportPeriod;
  title: string;
  executiveSummary: string[];
  sections: ReportSection[];
  metrics: Record<string, ReportMetric>;
  limitations: string[];
  sourceCompleteness: {
    sectionsPresent: string[];
    sectionsMissing: string[];
  };
  agentInstructions?: AgentInstructions;
  dashboard?: DashboardData;
  sourceData?: Record<string, unknown>;
}

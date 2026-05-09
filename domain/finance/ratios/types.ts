import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';

export type Severity = NodeSeverity;

export type FinancialRatiosOperation = 'calculate_financial_ratios';

export type FinancialRatioKey =
  | 'average_ticket'
  | 'burn_rate'
  | 'cash_ratio'
  | 'current_ratio'
  | 'debt_to_ebitda'
  | 'debt_to_equity'
  | 'ebitda_margin'
  | 'gross_margin'
  | 'ltv_cac'
  | 'net_margin'
  | 'operating_margin'
  | 'opex_ratio'
  | 'quick_ratio'
  | 'revenue_growth'
  | 'roa'
  | 'roe'
  | 'runway'
  | 'working_capital'
  | 'yoy_variation';

export type FinancialRatioCategory =
  | 'cash_flow'
  | 'efficiency'
  | 'growth'
  | 'leverage'
  | 'liquidity'
  | 'profitability'
  | 'return'
  | 'unit_economics';

export type BurnRateSource = 'auto' | 'cashOutflows' | 'monthlyExpenses';

export type FinancialRatioUnit =
  | 'currency'
  | 'currency_per_month'
  | 'currency_per_transaction'
  | 'decimal_ratio'
  | 'month';

export type OmittedRatioReason =
  | 'insufficient_data'
  | 'invalid_value'
  | 'missing_fields'
  | 'non_positive_burn_rate'
  | 'zero_denominator';

export type FinancialRatiosWarning = NodeWarning;

export type FinancialRatiosError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type FinancialRatiosMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, FinancialRatiosMetadata>;

export interface CalculateFinancialRatiosOptions {
  operation?: FinancialRatiosOperation;
  ratios?: FinancialRatioKey[];
  includePercentages?: boolean;
  currency?: string;
  burnRateSource?: BurnRateSource;
}

export interface FinancialRatioDefinition {
  key: FinancialRatioKey;
  label: string;
  category: FinancialRatioCategory;
  formula: string;
  requiredFields: string[];
  denominatorField?: string;
  unit: FinancialRatioUnit;
  supportsPercentage: boolean;
  requiresContext: boolean;
}

export interface FinancialRatioResult {
  key: FinancialRatioKey;
  label: string;
  category: FinancialRatioCategory;
  formula: string;
  value: string;
  percentage?: string;
  unit: FinancialRatioUnit;
  inputs: Record<string, string>;
  metadata: {
    currency: string | null;
    percentageIncluded: boolean;
    percentageScale?: '0_to_100';
    requiresContext: boolean;
    burnRateSource?: Exclude<BurnRateSource, 'auto'>;
  };
}

export interface OmittedFinancialRatio {
  key: FinancialRatioKey;
  label: string;
  category: FinancialRatioCategory;
  reason: OmittedRatioReason;
  missingFields: string[];
  denominatorField?: string;
  details?: Record<string, unknown>;
}

export interface FinancialRatiosData {
  currency: string | null;
  ratios: Partial<Record<FinancialRatioKey, FinancialRatioResult>>;
  omittedRatios: OmittedFinancialRatio[];
  summary: {
    requestedCount: number;
    calculatedCount: number;
    omittedCount: number;
  };
  inputFields: string[];
  calculationOptions: {
    burnRateSource: BurnRateSource;
    includePercentages: boolean;
    requestedRatios: FinancialRatioKey[];
  };
  datasetSupport: {
    status: 'postponed';
    message: string;
  };
}

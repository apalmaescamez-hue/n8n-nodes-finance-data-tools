import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';
import type { AccountingOperation } from '../../accounting';
import type { FinancialRatioKey } from '../../finance/ratios';
import type { FinancialReportType } from '../../finance/reports';
import type { MathStatisticsOperation } from '../../math/statistics';
import type { PredictiveAnalyticsOperation } from '../../ml/forecasting';

export type Severity = NodeSeverity;

export type AiFinanceToolOperation =
  | 'build_financial_report'
  | 'calculate_financial_ratios'
  | 'calculate_statistics'
  | 'clean_data'
  | 'evaluate_prediction_model'
  | 'forecast_financial_metric'
  | 'normalize_data'
  | 'profile_data'
  | 'train_simple_regression'
  | 'validate_accounting_entries';

export interface AiFinanceToolOptions {
  operation: AiFinanceToolOperation;
  allowPredictiveOperations?: boolean;
  maxRows?: number;
  maxForecastHorizon?: number;
  forecastHorizon?: number;
  currency?: string;
  valueColumn?: string;
  secondaryValueColumn?: string;
  xColumn?: string;
  actualColumn?: string;
  predictedColumn?: string;
  statisticsOperation?: MathStatisticsOperation;
  predictiveOperation?: PredictiveAnalyticsOperation;
  financialReportType?: FinancialReportType;
  accountingOperation?: AccountingOperation;
  ratios?: FinancialRatioKey[];
  domainOptions?: Record<string, unknown>;
}

export type AiFinanceToolWarning = NodeWarning;

export type AiFinanceToolError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type AiFinanceToolMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, AiFinanceToolMetadata>;

export interface AgentInstructions {
  canSummarize: boolean;
  mustMentionWarnings: boolean;
  mustNotOverstatePredictions: boolean;
  mustNotAssumeCausality: boolean;
  recommendedPrompt: string;
}

export interface AiFinanceToolData {
  requestedOperation: AiFinanceToolOperation;
  executedOperation: string;
  result: unknown;
  childSuccess: boolean;
  childMetadata: StandardNodeMetadata;
  controls: {
    allowPredictiveOperations: boolean;
    maxForecastHorizon: number;
    maxRows: number;
    rowCount: number;
  };
  summary: string;
  limitations: string[];
  agentInstructions: AgentInstructions;
}

export interface PredictionEvaluationData {
  actualColumn: string;
  predictedColumn: string;
  validPairCount: number;
  ignoredPairCount: number;
  metrics: {
    mae: string;
    mse: string;
    rmse: string;
    mape: string | null;
    zeroActualCount: number;
  };
}

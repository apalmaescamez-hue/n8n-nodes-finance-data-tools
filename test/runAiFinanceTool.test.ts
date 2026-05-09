import { describe, expect, it } from 'vitest';

import { runAiFinanceTool } from '../domain/ai/financeTool';
import type { AiFinanceToolData } from '../domain/ai/financeTool';
import {
  aiToolFinancialRatiosFixture,
  aiToolReportFixture,
  aiToolRowsFixture,
} from './fixtures/aiFinanceTool.fixture';

function dataOf(result: ReturnType<typeof runAiFinanceTool>): AiFinanceToolData {
  return result.data as AiFinanceToolData;
}

function errorCodes(result: ReturnType<typeof runAiFinanceTool>): string[] {
  return result.errors.map((error) => error.code);
}

describe('runAiFinanceTool', () => {
  it('routes profile_data through the controlled facade', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'profile_data',
      maxRows: 10,
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('profile_data');
    expect(data.requestedOperation).toBe('profile_data');
    expect(data.executedOperation).toBe('profileDataset');
    expect(data.agentInstructions.canSummarize).toBe(true);
  });

  it('blocks operations outside the allowlist', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'run_arbitrary_formula' as never,
    });

    expect(result.success).toBe(false);
    expect(errorCodes(result)).toContain('UNSUPPORTED_AI_TOOL_OPERATION');
  });

  it('enforces the maximum row limit before delegation', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'profile_data',
      maxRows: 2,
    });

    expect(result.success).toBe(false);
    expect(errorCodes(result)).toContain('MAX_ROWS_EXCEEDED');
  });

  it('blocks predictive operations unless explicitly enabled', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'forecast_financial_metric',
      valueColumn: 'revenue',
      forecastHorizon: 2,
    });

    expect(result.success).toBe(false);
    expect(errorCodes(result)).toContain('PREDICTIVE_OPERATION_NOT_ALLOWED');
  });

  it('enforces forecast horizon limits for predictive operations', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'forecast_financial_metric',
      allowPredictiveOperations: true,
      forecastHorizon: 5,
      maxForecastHorizon: 3,
      valueColumn: 'revenue',
    });

    expect(result.success).toBe(false);
    expect(errorCodes(result)).toContain('FORECAST_HORIZON_LIMIT_EXCEEDED');
  });

  it('routes forecast_financial_metric when predictive operations are allowed', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'forecast_financial_metric',
      allowPredictiveOperations: true,
      forecastHorizon: 2,
      maxForecastHorizon: 3,
      valueColumn: 'revenue',
      domainOptions: {
        operation: 'moving_average_forecast',
        windowSize: 2,
      },
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.executedOperation).toBe('moving_average_forecast');
    expect(data.agentInstructions.mustNotOverstatePredictions).toBe(true);
  });

  it('routes train_simple_regression through PredictiveAnalytics', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'train_simple_regression',
      allowPredictiveOperations: true,
      forecastHorizon: 1,
      valueColumn: 'revenue',
      xColumn: 'period',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.executedOperation).toBe('simple_linear_regression');
  });

  it('evaluates actual vs predicted columns', () => {
    const result = runAiFinanceTool(aiToolRowsFixture, {
      operation: 'evaluate_prediction_model',
      allowPredictiveOperations: true,
      actualColumn: 'revenue',
      predictedColumn: 'predicted',
    });
    const data = dataOf(result);
    const evaluation = data.result as { metrics: { mae: string }; validPairCount: number };

    expect(result.success).toBe(true);
    expect(data.executedOperation).toBe('evaluate_prediction_model');
    expect(evaluation.validPairCount).toBe(4);
    expect(evaluation.metrics.mae).toBe('1.5');
  });

  it('routes calculate_financial_ratios', () => {
    const result = runAiFinanceTool(aiToolFinancialRatiosFixture, {
      operation: 'calculate_financial_ratios',
      ratios: ['current_ratio', 'gross_margin'],
    });
    const data = dataOf(result);
    const ratios = data.result as { ratios: Record<string, { value: string }> };

    expect(result.success).toBe(true);
    expect(data.executedOperation).toBe('calculate_financial_ratios');
    expect(ratios.ratios.current_ratio.value).toBe('2');
  });

  it('routes build_financial_report', () => {
    const result = runAiFinanceTool(aiToolReportFixture, {
      operation: 'build_financial_report',
      financialReportType: 'profit_and_loss',
    });
    const data = dataOf(result);
    const report = data.result as { reportType: string; metrics: Record<string, { value: string | null }> };

    expect(result.success).toBe(true);
    expect(report.reportType).toBe('profit_and_loss');
    expect(report.metrics.grossProfit.value).toBe('600');
  });
});

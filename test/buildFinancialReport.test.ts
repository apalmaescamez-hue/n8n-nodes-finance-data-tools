import { describe, expect, it } from 'vitest';

import { buildFinancialReport } from '../domain/finance/reports';
import type { FinancialReportData } from '../domain/finance/reports';
import {
  fullFinancialReportFixture,
  invalidProfitAndLossFixture,
  numberInputFixture,
  unbalancedBalanceSheetFixture,
} from './fixtures/financialReportBuilder.fixture';

function dataOf(result: ReturnType<typeof buildFinancialReport>): FinancialReportData {
  return result.data as FinancialReportData;
}

function warningCodes(result: ReturnType<typeof buildFinancialReport>): string[] {
  return result.warnings.map((warning) => warning.code);
}

function errorCodes(result: ReturnType<typeof buildFinancialReport>): string[] {
  return result.errors.map((error) => error.code);
}

describe('buildFinancialReport', () => {
  it('builds a profit and loss report with decimal strings', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'profit_and_loss',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('build_financial_report');
    expect(data.sections).toHaveLength(1);
    expect(data.metrics.revenue.value).toBe('1000');
    expect(data.metrics.grossProfit.value).toBe('600');
    expect(data.metrics.operatingIncome.value).toBe('350');
    expect(data.metrics.netIncome.value).toBe('350');
    expect(data.metrics.grossMargin.value).toBe('0.6');
  });

  it('builds a balance sheet and validates the accounting equation as warning-only', () => {
    const result = buildFinancialReport(unbalancedBalanceSheetFixture, {
      reportType: 'balance_sheet',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.metrics.totalAssets.value).toBe('1000');
    expect(data.metrics.balanceEquationDifference.value).toBe('100');
    expect(warningCodes(result)).toContain('BALANCE_SHEET_UNBALANCED');
  });

  it('builds a cash summary and reconciles closing cash', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'cash_summary',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.metrics.netCashFlow.value).toBe('200');
    expect(data.metrics.closingCash.value).toBe('500');
    expect(result.warnings).toEqual([]);
  });

  it('builds a KPI table from kpis and ratios', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'kpi_table',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.sections[0].id).toBe('kpi_table');
    expect(data.metrics['kpi.customer_count'].value).toBe('25');
    expect(data.metrics['kpi.gross_margin'].value).toBe('0.6');
  });

  it('builds an executive summary from all available sections', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'executive_summary',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.sections.map((section) => section.id)).toEqual([
      'profit_and_loss',
      'balance_sheet',
      'cash_summary',
      'kpi_table',
    ]);
    expect(data.executiveSummary.join(' ')).toContain('Revenue');
  });

  it('builds an AI Agent report with instructions', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'ai_agent_report',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.agentInstructions).toMatchObject({
      canSummarize: true,
      mustNotOverstateResults: true,
    });
    expect(data.limitations.length).toBeGreaterThan(0);
  });

  it('builds dashboard-ready JSON cards and tables', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'dashboard_json',
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.dashboard?.cards.map((card) => card.key)).toContain('revenue');
    expect(data.dashboard?.tables.length).toBe(4);
  });

  it('returns an error envelope for invalid input', () => {
    const result = buildFinancialReport([{ revenue: '1000' }], {
      reportType: 'executive_summary',
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(errorCodes(result)).toContain('INVALID_INPUT');
  });

  it('returns an error envelope for unsupported report type', () => {
    const result = buildFinancialReport(fullFinancialReportFixture, {
      reportType: 'unknown_report' as never,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(errorCodes(result)).toContain('UNSUPPORTED_REPORT_TYPE');
  });

  it('returns an error envelope for invalid decimal input', () => {
    const result = buildFinancialReport(invalidProfitAndLossFixture, {
      reportType: 'profit_and_loss',
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(errorCodes(result)).toContain('INVALID_DECIMAL_AMOUNT');
  });

  it('warns when monetary input arrives as JavaScript number', () => {
    const result = buildFinancialReport(numberInputFixture, {
      reportType: 'profit_and_loss',
    });

    expect(result.success).toBe(true);
    expect(warningCodes(result)).toContain('NUMERIC_INPUT_AS_NUMBER');
  });
});

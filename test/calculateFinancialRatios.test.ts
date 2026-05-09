import { describe, expect, it } from 'vitest';

import { calculateFinancialRatios } from '../domain/finance/ratios';
import type { FinancialRatiosData } from '../domain/finance/ratios';
import {
  averageTicketFixture,
  cashFlowFixture,
  growthFixture,
  leverageFixture,
  liquidityFixture,
  opexFixture,
  profitabilityFixture,
  returnFixture,
  workingCapitalFixture,
} from './fixtures/financialRatios.fixture';

describe('calculateFinancialRatios', () => {
  it('calculates profitability margins with decimal and percentage strings', () => {
    const result = calculateFinancialRatios(profitabilityFixture, {
      ratios: ['gross_margin', 'net_margin', 'ebitda_margin', 'operating_margin'],
      includePercentages: true,
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(result.operation).toBe('calculate_financial_ratios');
    expect(result.errors).toEqual([]);
    expect(data.ratios.gross_margin?.value).toBe('0.6');
    expect(data.ratios.gross_margin?.percentage).toBe('60');
    expect(data.ratios.net_margin?.value).toBe('0.15');
    expect(data.ratios.ebitda_margin?.value).toBe('0.2');
    expect(data.ratios.operating_margin?.value).toBe('0.18');
  });

  it('calculates liquidity ratios', () => {
    const result = calculateFinancialRatios(liquidityFixture, {
      ratios: ['current_ratio', 'quick_ratio', 'cash_ratio'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.current_ratio?.value).toBe('2');
    expect(data.ratios.quick_ratio?.value).toBe('1');
    expect(data.ratios.cash_ratio?.value).toBe('0.4');
  });

  it('calculates debt to equity and debt to EBITDA', () => {
    const result = calculateFinancialRatios(leverageFixture, {
      ratios: ['debt_to_equity', 'debt_to_ebitda'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.debt_to_equity?.value).toBe('0.5');
    expect(data.ratios.debt_to_ebitda?.value).toBe('2');
    expect(result.warnings.map((warning) => warning.code)).toContain('RATIO_REQUIRES_CONTEXT');
  });

  it('calculates ROA and ROE', () => {
    const result = calculateFinancialRatios(returnFixture, {
      ratios: ['roa', 'roe'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.roa?.value).toBe('0.1');
    expect(data.ratios.roe?.value).toBe('0.2');
    expect(data.ratios.roa?.percentage).toBe('10');
    expect(data.ratios.roe?.percentage).toBe('20');
  });

  it('calculates working capital', () => {
    const result = calculateFinancialRatios(workingCapitalFixture, {
      ratios: ['working_capital'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.working_capital?.value).toBe('250');
    expect(data.ratios.working_capital?.unit).toBe('currency');
  });

  it('calculates revenue growth and YoY variation', () => {
    const result = calculateFinancialRatios(growthFixture, {
      ratios: ['revenue_growth', 'yoy_variation'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.revenue_growth?.value).toBe('0.2');
    expect(data.ratios.revenue_growth?.percentage).toBe('20');
    expect(data.ratios.yoy_variation?.value).toBe('0.1');
    expect(data.ratios.yoy_variation?.percentage).toBe('10');
  });

  it('calculates burn rate and runway', () => {
    const result = calculateFinancialRatios(cashFlowFixture, {
      ratios: ['burn_rate', 'runway'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.burn_rate?.value).toBe('200');
    expect(data.ratios.burn_rate?.metadata.burnRateSource).toBe('cashOutflows');
    expect(data.ratios.runway?.value).toBe('6');
    expect(data.ratios.runway?.unit).toBe('month');
  });

  it('calculates average ticket', () => {
    const result = calculateFinancialRatios(averageTicketFixture, {
      ratios: ['average_ticket'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.average_ticket?.value).toBe('40');
    expect(data.ratios.average_ticket?.unit).toBe('currency_per_transaction');
  });

  it('calculates opex ratio', () => {
    const result = calculateFinancialRatios(opexFixture, {
      ratios: ['opex_ratio'],
    });
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.opex_ratio?.value).toBe('0.3');
    expect(data.ratios.opex_ratio?.percentage).toBe('30');
  });

  it('warns and omits a ratio when the denominator is zero', () => {
    const result = calculateFinancialRatios(
      {
        currency: 'EUR',
        currentAssets: '500',
        currentLiabilities: '0',
      },
      {
        ratios: ['current_ratio'],
      },
    );
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.current_ratio).toBeUndefined();
    expect(data.omittedRatios[0]).toMatchObject({
      key: 'current_ratio',
      reason: 'zero_denominator',
      denominatorField: 'currentLiabilities',
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('DENOMINATOR_ZERO');
    expect(result.auditTrail.map((event) => event.step)).toContain('ratio_omitted');
  });

  it('warns and omits a ratio when required fields are missing', () => {
    const result = calculateFinancialRatios(
      {
        currency: 'EUR',
        currentAssets: '500',
      },
      {
        ratios: ['current_ratio'],
      },
    );
    const data = result.data as FinancialRatiosData;

    expect(result.success).toBe(true);
    expect(data.ratios.current_ratio).toBeUndefined();
    expect(data.omittedRatios[0]).toMatchObject({
      key: 'current_ratio',
      reason: 'missing_fields',
      missingFields: ['currentLiabilities'],
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('MISSING_REQUIRED_FIELDS');
    expect(result.warnings.map((warning) => warning.code)).toContain('RATIO_NOT_CALCULATED');
  });

  it('returns an error envelope for invalid input', () => {
    const result = calculateFinancialRatios([{ revenue: '1000' }], {
      ratios: ['gross_margin'],
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatchObject({
      code: 'INVALID_INPUT',
      severity: 'error',
    });
  });

  it('returns an error envelope for an unknown ratio', () => {
    const result = calculateFinancialRatios(profitabilityFixture, {
      ratios: ['unknown_ratio' as never],
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatchObject({
      code: 'UNSUPPORTED_RATIO',
      severity: 'error',
    });
  });
});

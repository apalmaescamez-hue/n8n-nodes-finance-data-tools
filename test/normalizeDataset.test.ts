import { describe, expect, it } from 'vitest';

import { normalizeDataset } from '../domain/data/normalization';
import { rawNormalizerRowsFixture } from './fixtures/normalizer.fixture';

describe('normalizeDataset', () => {
  it('returns a successful normalization envelope and maps or renames columns', () => {
    const result = normalizeDataset(
      [{ importe: '10,50', Cliente: 'ACME' }],
      {
        addCurrencyColumn: false,
        columnMapping: { importe: 'amount' },
        renameColumns: { Cliente: 'customerName' },
      },
    );

    expect(result.success).toBe(true);
    expect(result.operation).toBe('normalizeDataset');
    expect(result.errors).toEqual([]);
    expect(result.metadata.rowCount).toBe(1);
    expect(result.auditTrail.length).toBeGreaterThan(0);
    expect(result.data?.columnNameMap).toEqual({
      importe: 'amount',
      Cliente: 'customerName',
    });
    expect(result.data?.rows[0]).toEqual({ amount: '10,50', customerName: 'ACME' });
    expect(result.data?.summary.mappedOrRenamedColumns).toBe(2);
  });

  it('normalizes a European amount with currency symbol to a decimal string', () => {
    const result = normalizeDataset([{ amount: '1.234,56 €' }], {
      addCurrencyColumn: false,
      amountColumns: ['amount'],
    });

    expect(result.data?.rows[0]).toEqual({ amount: '1234.56' });
    expect(result.data?.summary.amountValuesNormalized).toBe(1);
  });

  it('normalizes configured dates to ISO dates', () => {
    const result = normalizeDataset([{ date: '15/03/2024' }], {
      addCurrencyColumn: false,
      dateColumns: ['date'],
    });

    expect(result.data?.rows[0]).toEqual({ date: '2024-03-15' });
    expect(result.data?.summary.dateValuesNormalized).toBe(1);
  });

  it('normalizes percentages to ratio decimal strings when configured', () => {
    const result = normalizeDataset([{ discount: '12,5%' }], {
      addCurrencyColumn: false,
      percentageColumns: ['discount'],
      percentageOutputMode: 'ratioDecimalString',
    });

    expect(result.data?.rows[0]).toEqual({ discount: '0.125' });
    expect(result.data?.summary.percentageValuesNormalized).toBe(1);
  });

  it('applies the default currency when the configured currency column is missing', () => {
    const result = normalizeDataset([{ amount: '10' }], {
      addCurrencyColumn: true,
      currencyColumn: 'currency',
      defaultCurrency: 'eur',
    });

    expect(result.data?.rows[0]).toEqual({ amount: '10', currency: 'EUR' });
    expect(result.data?.summary.currencyValuesNormalized).toBe(1);
    expect(result.data?.summary.defaultCurrencyValuesApplied).toBe(1);
  });

  it('generates an accounting period in YYYY-MM from a configured date column', () => {
    const result = normalizeDataset([{ date: '15/03/2024' }], {
      addCurrencyColumn: false,
      accountingPeriodDateColumn: 'date',
      dateColumns: ['date'],
    });

    expect(result.data?.rows[0]).toEqual({ date: '2024-03-15', accountingPeriod: '2024-03' });
    expect(result.data?.summary.accountingPeriodsGenerated).toBe(1);
  });

  it('normalizes simple category columns with trim and single spaces', () => {
    const result = normalizeDataset([{ account: '  Ventas   Europa  ' }], {
      addCurrencyColumn: false,
      categoryColumns: ['account'],
    });

    expect(result.data?.rows[0]).toEqual({ account: 'Ventas Europa' });
    expect(result.data?.summary.categoryValuesNormalized).toBe(1);
    expect(result.warnings.map((warning) => warning.code)).toContain('CATEGORY_VALUE_NORMALIZED');
  });

  it('warns when configured values cannot be parsed', () => {
    const result = normalizeDataset([{ amount: 'not parseable', date: '31/02/2024', discount: 'abc%' }], {
      addCurrencyColumn: false,
      amountColumns: ['amount'],
      dateColumns: ['date'],
      percentageColumns: ['discount'],
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows[0]).toEqual({ amount: 'not parseable', date: '31/02/2024', discount: 'abc%' });
    expect(result.data?.summary.unparseableAmountValues).toBe(1);
    expect(result.data?.summary.unparseableDateValues).toBe(1);
    expect(result.data?.summary.unparseablePercentageValues).toBe(1);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'UNPARSEABLE_AMOUNT_VALUE',
      'UNPARSEABLE_DATE_VALUE',
      'UNPARSEABLE_PERCENTAGE_VALUE',
    ]);
  });

  it('normalizes a representative finance fixture end to end', () => {
    const result = normalizeDataset(rawNormalizerRowsFixture, {
      accountingPeriodDateColumn: 'date',
      amountColumns: ['amount'],
      categoryColumns: ['account'],
      columnMapping: {
        Fecha: 'date',
        cuenta: 'account',
        descuento: 'discount',
        importe: 'amount',
      },
      dateColumns: ['date'],
      percentageColumns: ['discount'],
    });

    expect(result.data?.rows[0]).toEqual({
      date: '2024-03-15',
      amount: '1234.56',
      discount: '0.125',
      account: 'Ventas Europa',
      currency: 'EUR',
      accountingPeriod: '2024-03',
    });
    expect(result.data?.rowCount).toBe(2);
    expect(result.data?.summary.outputColumnCount).toBe(6);
  });

  it('returns an error envelope for invalid input', () => {
    const result = normalizeDataset({ not: 'an array' });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatchObject({
      code: 'INVALID_INPUT',
      severity: 'error',
    });
  });
});

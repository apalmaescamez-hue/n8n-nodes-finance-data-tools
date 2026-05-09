import { describe, expect, it } from 'vitest';

import { profileDataset } from '../domain/data/profiling';
import { financeRowsFixture } from './fixtures/profiler.fixture';

describe('profileDataset', () => {
  it('returns a successful profiling envelope for tabular finance rows', () => {
    const result = profileDataset(financeRowsFixture);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('profileDataset');
    expect(result.errors).toEqual([]);
    expect(result.metadata.rowCount).toBe(6);
    expect(result.metadata.columnCount).toBe(7);
    expect(result.auditTrail.length).toBeGreaterThan(0);
    expect(result.data?.rowCount).toBe(6);
    expect(result.data?.columnCount).toBe(7);
  });

  it('profiles column types, nulls, cardinality, and constant columns', () => {
    const result = profileDataset(financeRowsFixture);

    const priceColumn = result.data?.columns.find((column) => column.name === 'price');
    const volumeColumn = result.data?.columns.find((column) => column.name === 'volume');
    const currencyColumn = result.data?.columns.find((column) => column.name === 'currency');
    const asOfColumn = result.data?.columns.find((column) => column.name === 'asOf');

    expect(priceColumn?.inferredType).toBe('integer');
    expect(priceColumn?.nullCount).toBe(1);
    expect(priceColumn?.cardinality).toBe(4);
    expect(volumeColumn?.nullCount).toBe(2);
    expect(currencyColumn?.constant).toBe(true);
    expect(result.data?.constantColumns).toContain('currency');
    expect(asOfColumn?.inferredType).toBe('date');
  });

  it('calculates basic numeric statistics and IQR outliers', () => {
    const result = profileDataset(financeRowsFixture);
    const priceColumn = result.data?.columns.find((column) => column.name === 'price');
    const priceOutlier = result.data?.outliers.find((outlier) => outlier.column === 'price');

    expect(priceColumn?.numericStatistics).toMatchObject({
      count: 5,
      min: 100,
      max: 1000,
      median: 110,
      sum: 1430,
    });
    expect(priceOutlier).toMatchObject({
      column: 'price',
      method: 'iqr',
      count: 1,
    });
    expect(priceOutlier?.examples[0]).toEqual({ rowIndex: 2, value: 1000 });
  });

  it('detects duplicate rows', () => {
    const result = profileDataset(financeRowsFixture);

    expect(result.data?.duplicateRows.duplicateGroupCount).toBe(1);
    expect(result.data?.duplicateRows.duplicateRowCount).toBe(2);
    expect(result.data?.duplicateRows.groups[0]).toEqual({
      firstRowIndex: 0,
      rowIndexes: [0, 3],
      count: 2,
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('DUPLICATE_ROWS');
  });

  it('returns an error envelope for invalid input', () => {
    const result = profileDataset({ not: 'an array' });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatchObject({
      code: 'INVALID_INPUT',
      severity: 'error',
    });
  });
});

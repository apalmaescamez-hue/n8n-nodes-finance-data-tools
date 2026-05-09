import { describe, expect, it } from 'vitest';

import { calculateStatistics } from '../domain/math/statistics';
import type {
  CagrData,
  CorrelationData,
  GroupAggregateData,
  GrowthRateData,
  OutliersIqrData,
  PercentileData,
  SummaryStatisticsData,
  ZScoreData,
} from '../domain/math/statistics';
import {
  cagrRowsFixture,
  correlationRowsFixture,
  groupedRowsFixture,
  growthRowsFixture,
  nonNumericRowsFixture,
  outlierRowsFixture,
  summaryStatisticsRowsFixture,
  zScoreRowsFixture,
} from './fixtures/mathStatistics.fixture';

describe('calculateStatistics', () => {
  it('calculates summary statistics for a numeric column', () => {
    const result = calculateStatistics(summaryStatisticsRowsFixture, {
      operation: 'summary_statistics',
      valueColumn: 'amount',
    });
    const data = result.data as SummaryStatisticsData;

    expect(result.success).toBe(true);
    expect(result.operation).toBe('summary_statistics');
    expect(result.errors).toEqual([]);
    expect(result.metadata.rowCount).toBe(4);
    expect(result.auditTrail.length).toBeGreaterThan(0);
    expect(data.statistics).toEqual({
      count: 4,
      sum: '100',
      mean: '25',
      median: '25',
      min: '10',
      max: '40',
      variance: 125,
      standardDeviation: 11.18034,
    });
  });

  it('calculates a configurable percentile', () => {
    const result = calculateStatistics(summaryStatisticsRowsFixture, {
      operation: 'percentile',
      percentile: 75,
      valueColumn: 'amount',
    });
    const data = result.data as PercentileData;

    expect(result.success).toBe(true);
    expect(data.percentile).toBe(75);
    expect(data.value).toBe(32.5);
    expect(data.validCount).toBe(4);
  });

  it('calculates Pearson correlation between two numeric columns', () => {
    const result = calculateStatistics(correlationRowsFixture, {
      operation: 'correlation',
      valueColumn: 'x',
      secondaryValueColumn: 'y',
    });
    const data = result.data as CorrelationData;

    expect(result.success).toBe(true);
    expect(data.method).toBe('pearson');
    expect(data.correlation).toBe(1);
    expect(data.validPairCount).toBe(4);
  });

  it('calculates growth rate between first and last valid values', () => {
    const result = calculateStatistics(growthRowsFixture, {
      operation: 'growth_rate',
      growthMode: 'first_last',
      valueColumn: 'amount',
    });
    const data = result.data as GrowthRateData;

    expect(result.success).toBe(true);
    expect(data.result).toMatchObject({
      startValue: '100',
      endValue: '150',
      growthRate: '0.5',
      growthRatePercent: '50',
    });
    expect(data.divisionByZeroCount).toBe(0);
  });

  it('calculates CAGR using start value, end value, and periods', () => {
    const result = calculateStatistics(cagrRowsFixture, {
      operation: 'cagr',
      valueColumn: 'initialValue',
      secondaryValueColumn: 'finalValue',
      cagrPeriods: 2,
    });
    const data = result.data as CagrData;

    expect(result.success).toBe(true);
    expect(data.rowResults[0]).toMatchObject({
      startValue: '100',
      endValue: '121',
      periods: '2',
      cagr: '0.1',
      cagrPercent: '10',
    });
  });

  it('calculates z-scores per row', () => {
    const result = calculateStatistics(zScoreRowsFixture, {
      operation: 'z_score',
      valueColumn: 'amount',
      resultColumn: 'amountZScore',
    });
    const data = result.data as ZScoreData;

    expect(result.success).toBe(true);
    expect(data.mean).toBe('20');
    expect(data.standardDeviation).toBe(8.164966);
    expect(data.scores.map((score) => score.zScore)).toEqual([-1.224745, 0, 1.224745]);
    expect(data.rows[0]).toMatchObject({ amount: 10, amountZScore: -1.224745 });
  });

  it('detects IQR outliers', () => {
    const result = calculateStatistics(outlierRowsFixture, {
      operation: 'outliers_iqr',
      valueColumn: 'amount',
    });
    const data = result.data as OutliersIqrData;

    expect(result.success).toBe(true);
    expect(data).toMatchObject({
      q1: 11.25,
      q3: 12.75,
      iqr: 1.5,
      lowerFence: 9,
      upperFence: 15,
      count: 1,
    });
    expect(data.outliers[0]).toEqual({ rowIndex: 5, value: '100', numericValue: 100 });
  });

  it('aggregates values by group', () => {
    const result = calculateStatistics(groupedRowsFixture, {
      operation: 'group_aggregate',
      groupColumn: 'category',
      valueColumn: 'amount',
      aggregations: ['count', 'sum', 'mean', 'min', 'max'],
    });
    const data = result.data as GroupAggregateData;

    expect(result.success).toBe(true);
    expect(data.groups).toEqual([
      {
        groupValue: 'A',
        rowCount: 2,
        validValueCount: 2,
        ignoredValueCount: 0,
        count: 2,
        sum: '30',
        mean: '15',
        min: '10',
        max: '20',
      },
      {
        groupValue: 'B',
        rowCount: 3,
        validValueCount: 2,
        ignoredValueCount: 1,
        count: 3,
        sum: '20',
        mean: '10',
        min: '5',
        max: '15',
      },
    ]);
  });

  it('warns when non-numeric values are ignored', () => {
    const result = calculateStatistics(nonNumericRowsFixture, {
      operation: 'summary_statistics',
      valueColumn: 'amount',
    });
    const data = result.data as SummaryStatisticsData;

    expect(result.success).toBe(true);
    expect(data.statistics.count).toBe(2);
    expect(result.warnings.map((warning) => warning.code)).toContain('NON_NUMERIC_VALUES_IGNORED');
  });

  it('returns an error envelope for missing columns', () => {
    const result = calculateStatistics(summaryStatisticsRowsFixture, {
      operation: 'summary_statistics',
      valueColumn: 'missingAmount',
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatchObject({
      code: 'COLUMN_NOT_FOUND',
      severity: 'error',
      field: 'missingAmount',
    });
  });
});

import { describe, expect, it } from 'vitest';

import { runPredictiveAnalytics } from '../domain/ml/forecasting';
import type { PredictiveAnalyticsData } from '../domain/ml/forecasting';
import {
  cagrSeriesFixture,
  missingAndNonNumericSeriesFixture,
  noisySeriesFixture,
  numberSeriesFixture,
  regressionSeriesFixture,
  revenueSeriesFixture,
} from './fixtures/predictiveAnalytics.fixture';

function dataOf(result: ReturnType<typeof runPredictiveAnalytics>): PredictiveAnalyticsData {
  return result.data as PredictiveAnalyticsData;
}

function warningCodes(result: ReturnType<typeof runPredictiveAnalytics>): string[] {
  return result.warnings.map((warning) => warning.code);
}

function errorCodes(result: ReturnType<typeof runPredictiveAnalytics>): string[] {
  return result.errors.map((error) => error.code);
}

describe('runPredictiveAnalytics', () => {
  it('calculates moving average forecast', () => {
    const result = runPredictiveAnalytics(revenueSeriesFixture, {
      operation: 'moving_average_forecast',
      valueColumn: 'revenue',
      windowSize: 2,
      horizon: 3,
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('moving_average_forecast');
    expect(data.forecast.map((point) => point.forecast)).toEqual(['125', '127.5', '126.25']);
    expect(data.limitations.join(' ')).toContain('directional');
  });

  it('calculates CAGR forecast', () => {
    const result = runPredictiveAnalytics(cagrSeriesFixture, {
      operation: 'cagr_forecast',
      valueColumn: 'revenue',
      periodsPerYear: 1,
      horizon: 2,
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.forecast.map((point) => point.forecast)).toEqual(['133.1', '146.41']);
    expect(data.model?.slope).toBe('0.1');
  });

  it('calculates trend forecast over row order', () => {
    const result = runPredictiveAnalytics(revenueSeriesFixture, {
      operation: 'trend_forecast',
      valueColumn: 'revenue',
      horizon: 2,
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.model).toMatchObject({
      slope: '10',
      intercept: '90',
      rSquared: '1',
    });
    expect(data.forecast.map((point) => point.forecast)).toEqual(['140', '150']);
  });

  it('calculates simple linear regression forecast', () => {
    const result = runPredictiveAnalytics(regressionSeriesFixture, {
      operation: 'simple_linear_regression',
      valueColumn: 'sales',
      xColumn: 'x',
      horizon: 2,
    });
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.model).toMatchObject({
      slope: '2',
      intercept: '0',
      rSquared: '1',
      xColumn: 'x',
      yColumn: 'sales',
    });
    expect(data.forecast.map((point) => point.forecast)).toEqual(['10', '12']);
    expect(data.metrics.mae).toBe('0');
  });

  it('returns warnings for missing and non-numeric observations but keeps valid observations', () => {
    const result = runPredictiveAnalytics(missingAndNonNumericSeriesFixture, {
      operation: 'trend_forecast',
      valueColumn: 'revenue',
      horizon: 1,
    });

    expect(result.success).toBe(true);
    expect(warningCodes(result)).toEqual(expect.arrayContaining([
      'MISSING_VALUES_IGNORED',
      'NON_NUMERIC_VALUES_IGNORED',
      'SMALL_SAMPLE_SIZE',
    ]));
    expect(dataOf(result).inputSummary.validObservationCount).toBe(2);
  });

  it('warns for long horizon and detected outliers', () => {
    const result = runPredictiveAnalytics(noisySeriesFixture, {
      operation: 'moving_average_forecast',
      valueColumn: 'revenue',
      horizon: 10,
      maxHorizon: 3,
      windowSize: 3,
    });

    expect(result.success).toBe(true);
    expect(warningCodes(result)).toEqual(expect.arrayContaining([
      'FORECAST_HORIZON_HIGH',
      'HORIZON_EXCEEDS_HISTORY',
      'OUTLIERS_DETECTED',
    ]));
  });

  it('warns when predictive input arrives as JavaScript number', () => {
    const result = runPredictiveAnalytics(numberSeriesFixture, {
      operation: 'moving_average_forecast',
      valueColumn: 'revenue',
      horizon: 1,
    });

    expect(result.success).toBe(true);
    expect(warningCodes(result)).toContain('NUMERIC_INPUT_AS_NUMBER');
  });

  it('returns an error envelope for invalid input', () => {
    const result = runPredictiveAnalytics({ revenue: '100' }, {
      operation: 'moving_average_forecast',
      valueColumn: 'revenue',
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(errorCodes(result)).toContain('INVALID_INPUT');
  });

  it('returns an error envelope for missing value column', () => {
    const result = runPredictiveAnalytics(revenueSeriesFixture, {
      operation: 'moving_average_forecast',
      valueColumn: 'missingRevenue',
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(errorCodes(result)).toContain('COLUMN_NOT_FOUND');
  });

  it('returns an error envelope for missing x column in simple linear regression', () => {
    const result = runPredictiveAnalytics(regressionSeriesFixture, {
      operation: 'simple_linear_regression',
      valueColumn: 'sales',
      xColumn: '',
    });

    expect(result.success).toBe(false);
    expect(errorCodes(result)).toContain('MISSING_X_COLUMN');
  });

  it('returns an error envelope when CAGR cannot be computed from non-positive values', () => {
    const result = runPredictiveAnalytics([
      { period: 1, revenue: '0' },
      { period: 2, revenue: '100' },
    ], {
      operation: 'cagr_forecast',
      valueColumn: 'revenue',
      horizon: 1,
    });

    expect(result.success).toBe(false);
    expect(errorCodes(result)).toContain('INVALID_CAGR_SERIES');
  });
});

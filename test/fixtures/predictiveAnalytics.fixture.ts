export const revenueSeriesFixture = [
  { period: 1, revenue: '100' },
  { period: 2, revenue: '110' },
  { period: 3, revenue: '120' },
  { period: 4, revenue: '130' },
];

export const cagrSeriesFixture = [
  { period: '2024', revenue: '100' },
  { period: '2025', revenue: '110' },
  { period: '2026', revenue: '121' },
];

export const regressionSeriesFixture = [
  { x: '1', sales: '2' },
  { x: '2', sales: '4' },
  { x: '3', sales: '6' },
  { x: '4', sales: '8' },
];

export const noisySeriesFixture = [
  { period: 1, revenue: '100' },
  { period: 2, revenue: '105' },
  { period: 3, revenue: '108' },
  { period: 4, revenue: '110' },
  { period: 5, revenue: '1000' },
  { period: 6, revenue: '112' },
];

export const missingAndNonNumericSeriesFixture = [
  { period: 1, revenue: '100' },
  { period: 2, revenue: '' },
  { period: 3, revenue: 'not-a-number' },
  { period: 4, revenue: '130' },
];

export const numberSeriesFixture = [
  { period: 1, revenue: 100 },
  { period: 2, revenue: '110' },
  { period: 3, revenue: '120' },
];

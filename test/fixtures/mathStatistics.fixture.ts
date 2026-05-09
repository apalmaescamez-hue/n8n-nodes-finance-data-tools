import type { DataRow } from '../../domain/math/statistics';

export const summaryStatisticsRowsFixture: DataRow[] = [
  { amount: '10' },
  { amount: '20' },
  { amount: '30' },
  { amount: '40' },
];

export const correlationRowsFixture: DataRow[] = [
  { x: 1, y: 2 },
  { x: 2, y: 4 },
  { x: 3, y: 6 },
  { x: 4, y: 8 },
];

export const growthRowsFixture: DataRow[] = [
  { amount: '100' },
  { amount: '125' },
  { amount: '150' },
];

export const cagrRowsFixture: DataRow[] = [
  { initialValue: '100', finalValue: '121' },
];

export const zScoreRowsFixture: DataRow[] = [
  { amount: 10 },
  { amount: 20 },
  { amount: 30 },
];

export const outlierRowsFixture: DataRow[] = [
  { amount: 10 },
  { amount: 11 },
  { amount: 12 },
  { amount: 12 },
  { amount: 13 },
  { amount: 100 },
];

export const groupedRowsFixture: DataRow[] = [
  { category: 'A', amount: '10' },
  { category: 'A', amount: '20' },
  { category: 'B', amount: '5' },
  { category: 'B', amount: '15' },
  { category: 'B', amount: 'not numeric' },
];

export const nonNumericRowsFixture: DataRow[] = [
  { amount: '10' },
  { amount: 'not numeric' },
  { amount: '30' },
];

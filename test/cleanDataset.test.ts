import { describe, expect, it } from 'vitest';

import { cleanDataset } from '../domain/data/cleaning';
import { dirtyFinanceRowsFixture } from './fixtures/cleaner.fixture';

describe('cleanDataset', () => {
  it('returns a successful cleaning envelope and normalizes column names', () => {
    const result = cleanDataset(dirtyFinanceRowsFixture);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('cleanDataset');
    expect(result.errors).toEqual([]);
    expect(result.metadata.rowCount).toBe(3);
    expect(result.metadata.columnCount).toBe(5);
    expect(result.auditTrail.length).toBeGreaterThan(0);
    expect(result.data?.columnNameMap).toMatchObject({
      ' Customer Name ': 'customer_name',
      'Amount (€)': 'amount',
      DuplicateKey: 'duplicate_key',
    });
    expect(Object.keys(result.data?.rows[0] ?? {})).toEqual([
      'customer_name',
      'amount',
      'status',
      'notes',
      'duplicate_key',
    ]);
  });

  it('trims strings and collapses repeated whitespace', () => {
    const result = cleanDataset([{ name: '  ACME   Corp  ' }]);

    expect(result.data?.rows[0]).toEqual({ name: 'ACME Corp' });
    expect(result.data?.summary.trimmedValues).toBe(1);
    expect(result.data?.summary.compactedWhitespaceValues).toBe(1);
  });

  it('converts European numbers with currency symbols', () => {
    const result = cleanDataset([{ amount: '1.234,56 €' }], {
      cleanCurrencySymbols: true,
      convertEuropeanNumbers: true,
      numericColumns: ['amount'],
    });

    expect(result.data?.rows[0]).toEqual({ amount: 1234.56 });
    expect(result.data?.summary.currencySymbolsCleaned).toBe(1);
    expect(result.data?.summary.numericValuesConverted).toBe(1);
  });

  it('replaces configurable null-like values', () => {
    const result = cleanDataset(
      [{ value: 'N/A' }, { value: '' }, { value: null }, { value: undefined }],
      {
        nullValues: ['N/A', ''],
        nullReplacement: 0,
      },
    );

    expect(result.data?.rows).toEqual([{ value: 0 }, { value: 0 }, { value: 0 }, { value: 0 }]);
    expect(result.data?.summary.nullValuesReplaced).toBe(4);
  });

  it('removes empty columns when configured', () => {
    const result = cleanDataset(
      [
        { id: 1, empty: '', alsoEmpty: null },
        { id: 2, empty: ' ', alsoEmpty: undefined },
      ],
      { removeEmptyColumns: true },
    );

    expect(result.data?.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.data?.removedColumns).toEqual(['empty', 'also_empty']);
    expect(result.warnings.map((warning) => warning.code)).toContain('EMPTY_COLUMNS_REMOVED');
  });

  it('removes duplicates by configured keys', () => {
    const result = cleanDataset(dirtyFinanceRowsFixture, {
      removeDuplicates: true,
      deduplicateBy: 'keys',
      deduplicateKeys: ['DuplicateKey'],
    });

    expect(result.data?.rowCount).toBe(2);
    expect(result.data?.removedDuplicateRows).toEqual([
      {
        rowIndex: 1,
        duplicateOfRowIndex: 0,
      },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain('DUPLICATE_ROWS_REMOVED');
  });

  it('warns when configured numeric conversion cannot parse a value', () => {
    const result = cleanDataset([{ amount: 'not parseable' }], {
      convertEuropeanNumbers: true,
      numericColumns: ['amount'],
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows[0]).toEqual({ amount: 'not parseable' });
    expect(result.data?.summary.unparseableNumericValues).toBe(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'UNPARSEABLE_NUMERIC_VALUE',
      field: 'amount',
    });
  });
});

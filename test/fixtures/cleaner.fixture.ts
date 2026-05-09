import type { DataRow } from '../../domain/data/cleaning';

export const dirtyFinanceRowsFixture: DataRow[] = [
  {
    ' Customer Name ': '  ACME   Corp  ',
    'Amount (€)': '1.234,56 €',
    Status: ' ACTIVE ',
    Notes: '',
    DuplicateKey: 'A-1',
  },
  {
    ' Customer Name ': 'ACME Corp',
    'Amount (€)': '1.234,56 €',
    Status: 'ACTIVE',
    Notes: null,
    DuplicateKey: 'A-1',
  },
  {
    ' Customer Name ': 'Globex   Europe',
    'Amount (€)': 'not parseable',
    Status: ' N/A ',
    Notes: undefined,
    DuplicateKey: 'B-1',
  },
];

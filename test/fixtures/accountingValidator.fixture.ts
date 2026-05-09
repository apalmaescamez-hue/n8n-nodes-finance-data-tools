import type { AccountingInput } from '../../domain/accounting';

export const accountingAccountsFixture = [
  {
    code: '1000',
    name: 'Cash',
    type: 'asset',
    currency: 'EUR',
    active: true,
  },
  {
    code: '2000',
    name: 'Accounts Payable',
    type: 'liability',
    currency: 'EUR',
    active: true,
  },
  {
    code: '4000',
    name: 'Revenue',
    type: 'income',
    currency: 'EUR',
    active: true,
  },
  {
    code: '6000',
    name: 'Operating Expense',
    type: 'expense',
    currency: 'EUR',
    active: true,
  },
  {
    code: '9999',
    name: 'Legacy Suspense',
    type: 'asset',
    currency: 'EUR',
    active: false,
  },
] satisfies AccountingInput['accounts'];

export const validBalancedLedgerFixture: AccountingInput = {
  accounts: accountingAccountsFixture,
  entries: [
    {
      id: 'JE-001',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Customer invoice collected',
      lines: [
        {
          accountCode: '1000',
          debit: '1000.00',
          credit: '0',
          description: 'Cash received',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '1000.00',
          description: 'Revenue recognized',
        },
      ],
    },
  ],
};

export const trialBalanceLedgerFixture: AccountingInput = {
  accounts: accountingAccountsFixture,
  entries: [
    ...(validBalancedLedgerFixture.entries ?? []),
    {
      id: 'JE-002',
      date: '2026-01-20',
      currency: 'EUR',
      description: 'Operating expense paid',
      lines: [
        {
          accountCode: '6000',
          debit: '200.00',
          credit: '0',
          description: 'Expense incurred',
        },
        {
          accountCode: '1000',
          debit: '0',
          credit: '200.00',
          description: 'Cash paid',
        },
      ],
    },
  ],
};

export function withSingleEntry(entry: unknown): AccountingInput {
  return {
    accounts: accountingAccountsFixture,
    entries: [entry] as AccountingInput['entries'],
  };
}

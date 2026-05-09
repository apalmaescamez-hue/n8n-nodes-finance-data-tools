import { describe, expect, it } from 'vitest';

import { validateJournalEntries } from '../domain/accounting';
import type { AccountingValidationResult } from '../domain/accounting';
import {
  accountingAccountsFixture,
  trialBalanceLedgerFixture,
  validBalancedLedgerFixture,
  withSingleEntry,
} from './fixtures/accountingValidator.fixture';

function getData(result: ReturnType<typeof validateJournalEntries>): AccountingValidationResult {
  return result.data as AccountingValidationResult;
}

function getErrorCodes(result: ReturnType<typeof validateJournalEntries>): string[] {
  return result.errors.map((error) => error.code);
}

function getWarningCodes(result: ReturnType<typeof validateJournalEntries>): string[] {
  return result.warnings.map((warning) => warning.code);
}

describe('validateJournalEntries', () => {
  it('validates a balanced journal entry', () => {
    const result = validateJournalEntries(validBalancedLedgerFixture, {
      operation: 'validate_journal_entries',
      currency: 'EUR',
    });
    const data = getData(result);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('validate_journal_entries');
    expect(result.errors).toEqual([]);
    expect(data.isValid).toBe(true);
    expect(data.entriesValidated).toBe(1);
    expect(data.trialBalance).toBeUndefined();
    expect(result.auditTrail.map((event) => event.step)).toEqual(expect.arrayContaining([
      'input_validation',
      'chart_of_accounts_validation',
      'journal_entry_validation',
      'double_entry_check',
      'trial_balance_generation',
      'operation_completed',
    ]));
  });

  it('returns a blocking error for an unbalanced journal entry', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-UNBALANCED',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Unbalanced entry',
      lines: [
        {
          accountCode: '1000',
          debit: '100.00',
          credit: '0',
          description: 'Cash',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '90.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('JOURNAL_ENTRY_UNBALANCED');
    expect(getData(result).isValid).toBe(false);
  });

  it('returns a blocking error for an unknown account', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-UNKNOWN',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Unknown account',
      lines: [
        {
          accountCode: '1000',
          debit: '50.00',
          credit: '0',
          description: 'Cash',
        },
        {
          accountCode: '4999',
          debit: '0',
          credit: '50.00',
          description: 'Unknown revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('UNKNOWN_ACCOUNT');
  });

  it('returns a blocking error for a line without account', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-NO-ACCOUNT',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Missing account',
      lines: [
        {
          accountCode: '',
          debit: '50.00',
          credit: '0',
          description: 'Missing account',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '50.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('LINE_MISSING_ACCOUNT');
  });

  it('returns a blocking error for an invalid date', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-BAD-DATE',
      date: '2026-02-30',
      currency: 'EUR',
      description: 'Bad date',
      lines: [
        {
          accountCode: '1000',
          debit: '50.00',
          credit: '0',
          description: 'Cash',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '50.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('INVALID_ENTRY_DATE');
  });

  it('returns a blocking error for a non-decimal amount', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-BAD-AMOUNT',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Bad amount',
      lines: [
        {
          accountCode: '1000',
          debit: 'not-a-decimal',
          credit: '0',
          description: 'Cash',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '50.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('INVALID_DECIMAL_AMOUNT');
  });

  it('returns a blocking error for simultaneous debit and credit when not allowed', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-BOTH-SIDES',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Both sides',
      lines: [
        {
          accountCode: '1000',
          debit: '10.00',
          credit: '10.00',
          description: 'Invalid line',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '10.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('LINE_BOTH_DEBIT_AND_CREDIT');
  });

  it('returns a blocking error for a line with both amounts zero', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-ZERO-LINE',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Zero line',
      lines: [
        {
          accountCode: '1000',
          debit: '0',
          credit: '0',
          description: 'Zero line',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '10.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('LINE_ZERO_AMOUNTS');
  });

  it('returns a blocking error for inconsistent currency inside a journal entry', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-CURRENCY',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Currency mismatch',
      lines: [
        {
          accountCode: '1000',
          debit: '50.00',
          credit: '0',
          currency: 'USD',
          description: 'Cash',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '50.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('ENTRY_CURRENCY_MISMATCH');
  });

  it('warns for a line without description', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-LINE-WARNING',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Line warning',
      lines: [
        {
          accountCode: '1000',
          debit: '50.00',
          credit: '0',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '50.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(true);
    expect(getWarningCodes(result)).toContain('LINE_MISSING_DESCRIPTION');
  });

  it('warns for inactive accounts without blocking validation', () => {
    const result = validateJournalEntries(withSingleEntry({
      id: 'JE-INACTIVE',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Inactive account warning',
      lines: [
        {
          accountCode: '9999',
          debit: '50.00',
          credit: '0',
          description: 'Legacy suspense',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '50.00',
          description: 'Revenue',
        },
      ],
    }));

    expect(result.success).toBe(true);
    expect(getWarningCodes(result)).toContain('ACCOUNT_INACTIVE');
  });

  it('treats negative amounts as warnings or errors depending on options', () => {
    const input = withSingleEntry({
      id: 'JE-NEGATIVE',
      date: '2026-01-15',
      currency: 'EUR',
      description: 'Negative amount',
      lines: [
        {
          accountCode: '1000',
          debit: '-50.00',
          credit: '0',
          description: 'Negative cash',
        },
        {
          accountCode: '4000',
          debit: '0',
          credit: '-50.00',
          description: 'Negative revenue',
        },
      ],
    });

    const allowedResult = validateJournalEntries(input, {
      allowNegativeAmounts: true,
    });
    const blockedResult = validateJournalEntries(input, {
      allowNegativeAmounts: false,
    });

    expect(allowedResult.success).toBe(true);
    expect(getWarningCodes(allowedResult)).toContain('NEGATIVE_AMOUNT');
    expect(blockedResult.success).toBe(false);
    expect(getErrorCodes(blockedResult)).toContain('NEGATIVE_AMOUNT_NOT_ALLOWED');
  });

  it('builds a correct trial balance', () => {
    const result = validateJournalEntries(trialBalanceLedgerFixture, {
      operation: 'build_trial_balance',
    });
    const data = getData(result);

    expect(result.success).toBe(true);
    expect(data.trialBalance).toEqual([
      {
        accountCode: '1000',
        accountName: 'Cash',
        debitTotal: '1000',
        creditTotal: '200',
        balance: '800',
        balanceSide: 'debit',
      },
      {
        accountCode: '4000',
        accountName: 'Revenue',
        debitTotal: '0',
        creditTotal: '1000',
        balance: '1000',
        balanceSide: 'credit',
      },
      {
        accountCode: '6000',
        accountName: 'Operating Expense',
        debitTotal: '200',
        creditTotal: '0',
        balance: '200',
        balanceSide: 'debit',
      },
    ]);
  });

  it('validates and builds a trial balance in one operation', () => {
    const result = validateJournalEntries(trialBalanceLedgerFixture, {
      operation: 'validate_and_build_trial_balance',
    });
    const data = getData(result);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('validate_and_build_trial_balance');
    expect(data.isValid).toBe(true);
    expect(data.trialBalance).toHaveLength(3);
    expect(data.summary.trialBalanceGenerated).toBe(true);
  });

  it('returns a blocking error for invalid input', () => {
    const result = validateJournalEntries([{ entries: [] }]);
    const data = getData(result);

    expect(result.success).toBe(false);
    expect(data.isValid).toBe(false);
    expect(getErrorCodes(result)).toContain('INVALID_INPUT');
  });

  it('warns when an entry date is outside the expected period', () => {
    const result = validateJournalEntries(validBalancedLedgerFixture, {
      expectedPeriodStart: '2026-02-01',
      expectedPeriodEnd: '2026-02-28',
    });

    expect(result.success).toBe(true);
    expect(getWarningCodes(result)).toContain('ENTRY_DATE_OUTSIDE_EXPECTED_PERIOD');
  });

  it('warns when account currency metadata is missing or differs from the entry currency', () => {
    const result = validateJournalEntries({
      accounts: [
        {
          code: '1000',
          name: 'Cash',
          type: 'asset',
        },
        {
          code: '4000',
          name: 'Revenue',
          type: 'income',
          currency: 'USD',
        },
      ],
      entries: validBalancedLedgerFixture.entries,
    });

    expect(result.success).toBe(true);
    expect(getWarningCodes(result)).toEqual(expect.arrayContaining([
      'ACCOUNT_CURRENCY_MISSING',
      'ACCOUNT_CURRENCY_MISMATCH',
    ]));
  });

  it('returns a blocking error when an entry has no lines', () => {
    const result = validateJournalEntries({
      accounts: accountingAccountsFixture,
      entries: [
        {
          id: 'JE-NO-LINES',
          date: '2026-01-15',
          currency: 'EUR',
          description: 'No lines',
          lines: [],
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(getErrorCodes(result)).toContain('JOURNAL_ENTRY_WITHOUT_LINES');
  });
});

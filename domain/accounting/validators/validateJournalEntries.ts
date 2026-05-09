import Decimal from 'decimal.js';

import { buildTrialBalance } from '../ledger/buildTrialBalance';
import type {
  Account,
  AccountingOperation,
  AccountingValidationError,
  AccountingValidationOptions,
  AccountingValidationResult,
  AccountingValidationWarning,
  AccountType,
  AuditTrailEntry,
  NormalizedJournalEntry,
  NormalizedJournalLine,
  ToolEnvelope,
  TrialBalance,
} from '../models/types';
import { ACCOUNT_TYPES } from '../models/types';
import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';

const DEFAULT_CURRENCY = 'EUR';
const SUPPORTED_OPERATIONS: readonly AccountingOperation[] = [
  'build_trial_balance',
  'validate_and_build_trial_balance',
  'validate_journal_entries',
];

interface ParsedAccountingInput {
  accounts: Account[];
  entries: unknown[];
}

interface PeriodBounds {
  start: string | null;
  end: string | null;
}

interface ValidationRuntime {
  defaultCurrency: string;
  allowLineWithBothDebitAndCredit: boolean;
  allowNegativeAmounts: boolean;
  period: PeriodBounds;
  accountsByCode: Map<string, Account>;
  errors: AccountingValidationError[];
  warnings: AccountingValidationWarning[];
  entryIndexesWithErrors: Set<number>;
  entryIndexesWithWarnings: Set<number>;
  warningKeys: Set<string>;
}

interface ParsedDecimalAmount {
  value: Decimal;
  valid: boolean;
}

export function validateJournalEntries(
  input: unknown,
  options: AccountingValidationOptions = {},
): ToolEnvelope<AccountingValidationResult> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const requestedOperation = options.operation ?? 'validate_journal_entries';
  const operation = isAccountingOperation(requestedOperation)
    ? requestedOperation
    : String(requestedOperation);
  const errors: AccountingValidationError[] = [];
  const warnings: AccountingValidationWarning[] = [];
  const auditTrail: AuditTrailEntry[] = [];

  auditTrail.push(createAuditTrailEvent({
    timestamp: generatedAt,
    step: 'input_validation',
    message: 'Accounting validation input received.',
    details: {
      requestedOperation,
    },
  }));

  if (!isAccountingOperation(requestedOperation)) {
    errors.push(createError({
      code: 'UNSUPPORTED_OPERATION',
      message: `Unsupported accounting operation: ${String(requestedOperation)}`,
      details: {
        supportedOperations: SUPPORTED_OPERATIONS,
      },
    }));

    return finalizeEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      accountsCount: 0,
      defaultCurrency: resolveDefaultCurrency(options.currency),
      entriesValidated: 0,
      entriesWithErrors: 0,
      entriesWithWarnings: 0,
      errors,
      warnings,
      auditTrail,
      trialBalance: undefined,
    });
  }

  const defaultCurrency = resolveDefaultCurrency(options.currency);
  const period = resolvePeriodBounds(options.expectedPeriodStart, options.expectedPeriodEnd, errors);
  const parsedInput = parseAccountingInput(input, errors);

  auditTrail.push(createAuditTrailEvent({
    step: 'input_validation',
    message: errors.length === 0
      ? 'Accounting input shape and options were validated.'
      : 'Accounting input shape or options failed validation.',
    details: {
      accountCount: parsedInput?.accounts.length ?? 0,
      entryCount: parsedInput?.entries.length ?? 0,
      errorCount: errors.length,
    },
  }));

  const accountsByCode = new Map<string, Account>();

  if (parsedInput !== null) {
    validateChartOfAccounts(parsedInput.accounts, accountsByCode, errors);
  }

  auditTrail.push(createAuditTrailEvent({
    step: 'chart_of_accounts_validation',
    message: 'Chart of accounts validation completed.',
    details: {
      accountCount: accountsByCode.size,
      errorCount: errors.length,
    },
  }));

  const runtime: ValidationRuntime = {
    defaultCurrency,
    allowLineWithBothDebitAndCredit: options.allowLineWithBothDebitAndCredit ?? false,
    allowNegativeAmounts: options.allowNegativeAmounts ?? false,
    period,
    accountsByCode,
    errors,
    warnings,
    entryIndexesWithErrors: new Set<number>(),
    entryIndexesWithWarnings: new Set<number>(),
    warningKeys: new Set<string>(),
  };
  const normalizedEntries = parsedInput === null
    ? []
    : validateEntries(parsedInput.entries, runtime);

  auditTrail.push(createAuditTrailEvent({
    step: 'journal_entry_validation',
    message: 'Journal entry and line validation completed.',
    details: {
      entriesValidated: parsedInput?.entries.length ?? 0,
      entriesWithErrors: runtime.entryIndexesWithErrors.size,
      entriesWithWarnings: runtime.entryIndexesWithWarnings.size,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  }));

  runDoubleEntryChecks(normalizedEntries, runtime);

  auditTrail.push(createAuditTrailEvent({
    step: 'double_entry_check',
    message: 'Double-entry checks completed.',
    details: {
      checkedEntries: normalizedEntries.length,
      entriesWithErrors: runtime.entryIndexesWithErrors.size,
      errorCount: errors.length,
    },
  }));

  const shouldBuildTrialBalance = shouldGenerateTrialBalance(requestedOperation, options.includeTrialBalance);
  let trialBalance: TrialBalance[] | undefined;

  if (shouldBuildTrialBalance && errors.length === 0) {
    trialBalance = buildTrialBalance(normalizedEntries, accountsByCode);
    auditTrail.push(createAuditTrailEvent({
      step: 'trial_balance_generation',
      message: 'Trial balance generated from validated journal entries.',
      details: {
        accountCount: trialBalance.length,
      },
    }));
  } else {
    auditTrail.push(createAuditTrailEvent({
      step: 'trial_balance_generation',
      message: 'Trial balance generation skipped.',
      details: {
        requested: shouldBuildTrialBalance,
        skippedBecause: errors.length > 0 ? 'blocking_errors' : 'not_requested',
      },
    }));
  }

  auditTrail.push(createAuditTrailEvent({
    step: 'operation_completed',
    message: errors.length === 0
      ? 'Accounting validation operation completed successfully.'
      : 'Accounting validation operation completed with blocking errors.',
    details: {
      success: errors.length === 0,
      warningCount: warnings.length,
      errorCount: errors.length,
      trialBalanceGenerated: trialBalance !== undefined,
    },
  }));

  return finalizeEnvelope({
    operation: requestedOperation,
    generatedAt,
    startedAt,
    rowCount: parsedInput?.entries.length ?? 0,
    columnCount: accountsByCode.size,
    accountsCount: accountsByCode.size,
    defaultCurrency,
    entriesValidated: parsedInput?.entries.length ?? 0,
    entriesWithErrors: runtime.entryIndexesWithErrors.size,
    entriesWithWarnings: runtime.entryIndexesWithWarnings.size,
    errors,
    warnings,
    auditTrail,
    trialBalance,
  });
}

function finalizeEnvelope({
  operation,
  generatedAt,
  startedAt,
  rowCount,
  columnCount,
  accountsCount,
  defaultCurrency,
  entriesValidated,
  entriesWithErrors,
  entriesWithWarnings,
  errors,
  warnings,
  auditTrail,
  trialBalance,
}: {
  operation: string;
  generatedAt: string;
  startedAt: number;
  rowCount: number;
  columnCount: number;
  accountsCount: number;
  defaultCurrency: string;
  entriesValidated: number;
  entriesWithErrors: number;
  entriesWithWarnings: number;
  errors: AccountingValidationError[];
  warnings: AccountingValidationWarning[];
  auditTrail: AuditTrailEntry[];
  trialBalance: TrialBalance[] | undefined;
}): ToolEnvelope<AccountingValidationResult> {
  const data: AccountingValidationResult = {
    isValid: errors.length === 0,
    entriesValidated,
    errors,
    warnings,
    auditTrail,
    summary: {
      accountCount: accountsCount,
      currency: defaultCurrency,
      entriesWithErrors,
      entriesWithWarnings,
      trialBalanceGenerated: trialBalance !== undefined,
    },
  };

  if (trialBalance !== undefined) {
    data.trialBalance = trialBalance;
  }

  const outputParams = {
    operation,
    data,
    metadata: {
      rowCount,
      columnCount,
      generatedAt,
      startedAt,
    },
    warnings,
    errors,
    auditTrail,
  };

  return errors.length === 0
    ? createSuccessOutput(outputParams)
    : createFailureOutput<AccountingValidationResult>(outputParams);
}

function parseAccountingInput(
  input: unknown,
  errors: AccountingValidationError[],
): ParsedAccountingInput | null {
  if (!isRecord(input)) {
    errors.push(createError({
      code: 'INVALID_INPUT',
      message: 'Expected one accounting object with accounts and journal entries.',
      details: {
        receivedType: Array.isArray(input) ? 'array' : typeof input,
      },
    }));
    return null;
  }

  const accounts = Array.isArray(input.accounts)
    ? input.accounts
    : Array.isArray(input.chartOfAccounts)
      ? input.chartOfAccounts
      : null;
  const entries = Array.isArray(input.entries)
    ? input.entries
    : isRecord(input.ledger) && Array.isArray(input.ledger.entries)
      ? input.ledger.entries
      : null;

  if (accounts === null) {
    errors.push(createError({
      code: 'INVALID_INPUT',
      message: 'A chart of accounts array is required at accounts or chartOfAccounts.',
      field: 'accounts',
    }));
  }

  if (entries === null) {
    errors.push(createError({
      code: 'INVALID_INPUT',
      message: 'Journal entries are required at entries or ledger.entries.',
      field: 'entries',
    }));
  }

  if (accounts === null || entries === null) {
    return null;
  }

  return {
    accounts,
    entries,
  };
}

function validateChartOfAccounts(
  rawAccounts: unknown[],
  accountsByCode: Map<string, Account>,
  errors: AccountingValidationError[],
): void {
  if (rawAccounts.length === 0) {
    errors.push(createError({
      code: 'CHART_OF_ACCOUNTS_EMPTY',
      message: 'At least one account is required to validate journal entries.',
      field: 'accounts',
    }));
    return;
  }

  rawAccounts.forEach((rawAccount, accountIndex) => {
    if (!isRecord(rawAccount)) {
      errors.push(createError({
        code: 'INVALID_ACCOUNT',
        message: 'Each account must be an object.',
        field: `accounts[${accountIndex}]`,
      }));
      return;
    }

    const code = cleanText(rawAccount.code);
    const name = cleanText(rawAccount.name);
    const type = cleanText(rawAccount.type);
    const currency = cleanCurrency(rawAccount.currency);

    if (!code) {
      errors.push(createError({
        code: 'ACCOUNT_CODE_MISSING',
        message: 'Account code is required.',
        field: `accounts[${accountIndex}].code`,
      }));
      return;
    }

    if (!name) {
      errors.push(createError({
        code: 'ACCOUNT_NAME_MISSING',
        message: 'Account name is required.',
        field: `accounts[${accountIndex}].name`,
      }));
      return;
    }

    if (!isAccountType(type)) {
      errors.push(createError({
        code: 'INVALID_ACCOUNT_TYPE',
        message: 'Account type must be asset, liability, equity, income, or expense.',
        field: `accounts[${accountIndex}].type`,
        details: {
          accountCode: code,
          supportedTypes: ACCOUNT_TYPES,
        },
      }));
      return;
    }

    if (accountsByCode.has(code)) {
      errors.push(createError({
        code: 'DUPLICATE_ACCOUNT',
        message: `Account code "${code}" is duplicated in the chart of accounts.`,
        field: `accounts[${accountIndex}].code`,
        details: {
          accountCode: code,
        },
      }));
      return;
    }

    const account: Account = {
      code,
      name,
      type,
      active: typeof rawAccount.active === 'boolean' ? rawAccount.active : true,
    };

    if (currency !== null) {
      account.currency = currency;
    }

    accountsByCode.set(code, account);
  });
}

function validateEntries(
  rawEntries: unknown[],
  runtime: ValidationRuntime,
): NormalizedJournalEntry[] {
  const normalizedEntries: NormalizedJournalEntry[] = [];

  rawEntries.forEach((rawEntry, entryIndex) => {
    if (!isRecord(rawEntry)) {
      addEntryError(runtime, entryIndex, {
        code: 'INVALID_JOURNAL_ENTRY',
        message: 'Each journal entry must be an object.',
        field: `entries[${entryIndex}]`,
      });
      return;
    }

    const entryErrorCountBefore = runtime.errors.length;
    const entryId = cleanText(rawEntry.id) || `entry-${entryIndex + 1}`;
    const entryDate = parseIsoDate(cleanText(rawEntry.date));
    const entryCurrency = cleanCurrency(rawEntry.currency) ?? runtime.defaultCurrency;
    const description = cleanOptionalText(rawEntry.description);
    const rawLines = Array.isArray(rawEntry.lines) ? rawEntry.lines : null;

    if (entryDate === null) {
      addEntryError(runtime, entryIndex, {
        code: 'INVALID_ENTRY_DATE',
        message: 'Journal entry date must be a valid ISO date in YYYY-MM-DD format.',
        field: `entries[${entryIndex}].date`,
        details: {
          entryId,
          date: rawEntry.date,
        },
      });
    }

    if (description === undefined) {
      addEntryWarning(runtime, entryIndex, {
        code: 'ENTRY_MISSING_DESCRIPTION',
        severity: 'warning',
        message: 'Journal entry has no description.',
        field: `entries[${entryIndex}].description`,
        details: {
          entryId,
        },
      });
    }

    if (entryDate !== null) {
      addPeriodWarningIfNeeded(entryDate, entryId, entryIndex, runtime);
    }

    if (rawLines === null || rawLines.length === 0) {
      addEntryError(runtime, entryIndex, {
        code: 'JOURNAL_ENTRY_WITHOUT_LINES',
        message: 'Journal entry must contain at least one line.',
        field: `entries[${entryIndex}].lines`,
        details: {
          entryId,
        },
      });
      return;
    }

    const normalizedLines = validateLines({
      rawLines,
      entryId,
      entryIndex,
      entryCurrency,
      runtime,
    });

    if (runtime.errors.length > entryErrorCountBefore) {
      return;
    }

    const totalDebit = sumLines(normalizedLines, 'debit');
    const totalCredit = sumLines(normalizedLines, 'credit');
    const normalizedEntry: NormalizedJournalEntry = {
      entryIndex,
      id: entryId,
      date: entryDate ?? cleanText(rawEntry.date),
      currency: entryCurrency,
      lines: normalizedLines,
      totalDebit,
      totalCredit,
    };

    if (description !== undefined) {
      normalizedEntry.description = description;
    }

    normalizedEntries.push(normalizedEntry);
  });

  return normalizedEntries;
}

function validateLines({
  rawLines,
  entryId,
  entryIndex,
  entryCurrency,
  runtime,
}: {
  rawLines: unknown[];
  entryId: string;
  entryIndex: number;
  entryCurrency: string;
  runtime: ValidationRuntime;
}): NormalizedJournalLine[] {
  const normalizedLines: NormalizedJournalLine[] = [];

  rawLines.forEach((rawLine, lineIndex) => {
    if (!isRecord(rawLine)) {
      addEntryError(runtime, entryIndex, {
        code: 'INVALID_JOURNAL_LINE',
        message: 'Each journal line must be an object.',
        field: `entries[${entryIndex}].lines[${lineIndex}]`,
        details: {
          entryId,
        },
      });
      return;
    }

    const accountCode = cleanText(rawLine.accountCode);
    const description = cleanOptionalText(rawLine.description);
    const lineCurrency = resolveLineCurrency(rawLine) ?? entryCurrency;
    const debit = parseDecimalAmount(rawLine.debit);
    const credit = parseDecimalAmount(rawLine.credit);

    if (!accountCode) {
      addEntryError(runtime, entryIndex, {
        code: 'LINE_MISSING_ACCOUNT',
        message: 'Journal line accountCode is required.',
        field: `entries[${entryIndex}].lines[${lineIndex}].accountCode`,
        details: {
          entryId,
          lineIndex,
        },
      });
    }

    const account = accountCode ? runtime.accountsByCode.get(accountCode) : undefined;

    if (accountCode && account === undefined) {
      addEntryError(runtime, entryIndex, {
        code: 'UNKNOWN_ACCOUNT',
        message: `Account "${accountCode}" does not exist in the chart of accounts.`,
        field: `entries[${entryIndex}].lines[${lineIndex}].accountCode`,
        details: {
          accountCode,
          entryId,
          lineIndex,
        },
      });
    }

    if (!debit.valid) {
      addEntryError(runtime, entryIndex, {
        code: 'INVALID_DECIMAL_AMOUNT',
        message: 'Debit must be a valid decimal amount.',
        field: `entries[${entryIndex}].lines[${lineIndex}].debit`,
        details: {
          entryId,
          lineIndex,
          value: rawLine.debit,
        },
      });
    }

    if (!credit.valid) {
      addEntryError(runtime, entryIndex, {
        code: 'INVALID_DECIMAL_AMOUNT',
        message: 'Credit must be a valid decimal amount.',
        field: `entries[${entryIndex}].lines[${lineIndex}].credit`,
        details: {
          entryId,
          lineIndex,
          value: rawLine.credit,
        },
      });
    }

    if (lineCurrency !== entryCurrency) {
      addEntryError(runtime, entryIndex, {
        code: 'ENTRY_CURRENCY_MISMATCH',
        message: 'All journal lines must use the same currency as the journal entry.',
        field: `entries[${entryIndex}].lines[${lineIndex}].currency`,
        details: {
          entryCurrency,
          entryId,
          lineCurrency,
          lineIndex,
        },
      });
    }

    if (description === undefined) {
      addEntryWarning(runtime, entryIndex, {
        code: 'LINE_MISSING_DESCRIPTION',
        severity: 'warning',
        message: 'Journal line has no description.',
        field: `entries[${entryIndex}].lines[${lineIndex}].description`,
        details: {
          entryId,
          lineIndex,
        },
      });
    }

    if (account !== undefined) {
      addAccountWarnings(account, entryCurrency, entryId, entryIndex, lineIndex, runtime);
    }

    if (!debit.valid || !credit.valid) {
      return;
    }

    if (!debit.value.isZero() && !credit.value.isZero() && !runtime.allowLineWithBothDebitAndCredit) {
      addEntryError(runtime, entryIndex, {
        code: 'LINE_BOTH_DEBIT_AND_CREDIT',
        message: 'Journal line cannot have debit and credit simultaneously unless explicitly allowed.',
        field: `entries[${entryIndex}].lines[${lineIndex}]`,
        details: {
          entryId,
          lineIndex,
          debit: formatDecimal(debit.value),
          credit: formatDecimal(credit.value),
        },
      });
    }

    if (debit.value.isZero() && credit.value.isZero()) {
      addEntryError(runtime, entryIndex, {
        code: 'LINE_ZERO_AMOUNTS',
        message: 'Journal line cannot have both debit and credit equal to zero.',
        field: `entries[${entryIndex}].lines[${lineIndex}]`,
        details: {
          entryId,
          lineIndex,
        },
      });
    }

    addNegativeAmountMessages({
      amount: debit.value,
      amountField: 'debit',
      entryId,
      entryIndex,
      lineIndex,
      runtime,
    });
    addNegativeAmountMessages({
      amount: credit.value,
      amountField: 'credit',
      entryId,
      entryIndex,
      lineIndex,
      runtime,
    });

    if (account === undefined || runtime.entryIndexesWithErrors.has(entryIndex)) {
      return;
    }

    const normalizedLine: NormalizedJournalLine = {
      accountCode,
      accountName: account.name,
      accountType: account.type,
      debit: debit.value,
      credit: credit.value,
      currency: lineCurrency,
    };

    if (description !== undefined) {
      normalizedLine.description = description;
    }

    const costCenter = cleanOptionalText(rawLine.costCenter);

    if (costCenter !== undefined) {
      normalizedLine.costCenter = costCenter;
    }

    if (isRecord(rawLine.metadata)) {
      normalizedLine.metadata = rawLine.metadata;
    }

    normalizedLines.push(normalizedLine);
  });

  return normalizedLines;
}

function runDoubleEntryChecks(
  normalizedEntries: NormalizedJournalEntry[],
  runtime: ValidationRuntime,
): void {
  for (const entry of normalizedEntries) {
    if (entry.totalDebit.equals(entry.totalCredit)) {
      continue;
    }

    runtime.errors.push(createError({
      code: 'JOURNAL_ENTRY_UNBALANCED',
      message: 'Journal entry is unbalanced: total debit must equal total credit.',
      field: `entries[${entry.entryIndex}].lines`,
      details: {
        entryId: entry.id,
        totalDebit: formatDecimal(entry.totalDebit),
        totalCredit: formatDecimal(entry.totalCredit),
      },
    }));

    runtime.entryIndexesWithErrors.add(entry.entryIndex);
  }
}

function addAccountWarnings(
  account: Account,
  entryCurrency: string,
  entryId: string,
  entryIndex: number,
  lineIndex: number,
  runtime: ValidationRuntime,
): void {
  if (account.active === false) {
    addWarningOnce(runtime, `ACCOUNT_INACTIVE:${account.code}`, entryIndex, {
      code: 'ACCOUNT_INACTIVE',
      severity: 'warning',
      message: `Account "${account.code}" is inactive.`,
      field: `entries[${entryIndex}].lines[${lineIndex}].accountCode`,
      details: {
        accountCode: account.code,
        entryId,
      },
    });
  }

  if (account.currency === undefined || account.currency.trim() === '') {
    addWarningOnce(runtime, `ACCOUNT_CURRENCY_MISSING:${account.code}`, entryIndex, {
      code: 'ACCOUNT_CURRENCY_MISSING',
      severity: 'warning',
      message: `Account "${account.code}" has no currency while currency validation is active.`,
      field: `entries[${entryIndex}].lines[${lineIndex}].accountCode`,
      details: {
        accountCode: account.code,
        entryCurrency,
        entryId,
      },
    });
    return;
  }

  if (account.currency !== entryCurrency) {
    addWarningOnce(runtime, `ACCOUNT_CURRENCY_MISMATCH:${account.code}:${entryCurrency}`, entryIndex, {
      code: 'ACCOUNT_CURRENCY_MISMATCH',
      severity: 'warning',
      message: `Account "${account.code}" currency differs from the journal entry currency.`,
      field: `entries[${entryIndex}].lines[${lineIndex}].accountCode`,
      details: {
        accountCode: account.code,
        accountCurrency: account.currency,
        entryCurrency,
        entryId,
      },
    });
  }
}

function addNegativeAmountMessages({
  amount,
  amountField,
  entryId,
  entryIndex,
  lineIndex,
  runtime,
}: {
  amount: Decimal;
  amountField: 'credit' | 'debit';
  entryId: string;
  entryIndex: number;
  lineIndex: number;
  runtime: ValidationRuntime;
}): void {
  if (!amount.isNegative()) {
    return;
  }

  const message = {
    code: runtime.allowNegativeAmounts ? 'NEGATIVE_AMOUNT' : 'NEGATIVE_AMOUNT_NOT_ALLOWED',
    message: runtime.allowNegativeAmounts
      ? 'Journal line contains a negative amount.'
      : 'Negative journal line amounts are not allowed by current options.',
    field: `entries[${entryIndex}].lines[${lineIndex}].${amountField}`,
    details: {
      amount: formatDecimal(amount),
      amountField,
      entryId,
      lineIndex,
    },
  };

  if (runtime.allowNegativeAmounts) {
    addEntryWarning(runtime, entryIndex, {
      ...message,
      severity: 'warning',
    });
    return;
  }

  addEntryError(runtime, entryIndex, message);
}

function addPeriodWarningIfNeeded(
  entryDate: string,
  entryId: string,
  entryIndex: number,
  runtime: ValidationRuntime,
): void {
  if (runtime.period.start !== null && entryDate < runtime.period.start) {
    addEntryWarning(runtime, entryIndex, {
      code: 'ENTRY_DATE_OUTSIDE_EXPECTED_PERIOD',
      severity: 'warning',
      message: 'Journal entry date is before the expected period start.',
      field: `entries[${entryIndex}].date`,
      details: {
        entryDate,
        entryId,
        expectedPeriodStart: runtime.period.start,
      },
    });
  }

  if (runtime.period.end !== null && entryDate > runtime.period.end) {
    addEntryWarning(runtime, entryIndex, {
      code: 'ENTRY_DATE_OUTSIDE_EXPECTED_PERIOD',
      severity: 'warning',
      message: 'Journal entry date is after the expected period end.',
      field: `entries[${entryIndex}].date`,
      details: {
        entryDate,
        entryId,
        expectedPeriodEnd: runtime.period.end,
      },
    });
  }
}

function resolvePeriodBounds(
  expectedPeriodStart: string | undefined,
  expectedPeriodEnd: string | undefined,
  errors: AccountingValidationError[],
): PeriodBounds {
  const start = cleanText(expectedPeriodStart) ? parseIsoDate(cleanText(expectedPeriodStart)) : null;
  const end = cleanText(expectedPeriodEnd) ? parseIsoDate(cleanText(expectedPeriodEnd)) : null;

  if (cleanText(expectedPeriodStart) && start === null) {
    errors.push(createError({
      code: 'INVALID_EXPECTED_PERIOD',
      message: 'expectedPeriodStart must be a valid ISO date in YYYY-MM-DD format.',
      field: 'expectedPeriodStart',
    }));
  }

  if (cleanText(expectedPeriodEnd) && end === null) {
    errors.push(createError({
      code: 'INVALID_EXPECTED_PERIOD',
      message: 'expectedPeriodEnd must be a valid ISO date in YYYY-MM-DD format.',
      field: 'expectedPeriodEnd',
    }));
  }

  if (start !== null && end !== null && start > end) {
    errors.push(createError({
      code: 'INVALID_EXPECTED_PERIOD',
      message: 'expectedPeriodStart must be before or equal to expectedPeriodEnd.',
      field: 'expectedPeriodStart',
      details: {
        expectedPeriodEnd: end,
        expectedPeriodStart: start,
      },
    }));
  }

  return {
    start,
    end,
  };
}

function shouldGenerateTrialBalance(
  operation: AccountingOperation,
  includeTrialBalance: boolean | undefined,
): boolean {
  return operation === 'build_trial_balance' ||
    operation === 'validate_and_build_trial_balance' ||
    includeTrialBalance === true;
}

function sumLines(lines: NormalizedJournalLine[], side: 'credit' | 'debit'): Decimal {
  return lines.reduce((total, line) => total.plus(line[side]), new Decimal(0));
}

function parseDecimalAmount(value: unknown): ParsedDecimalAmount {
  if (isMissingAmount(value)) {
    return {
      valid: true,
      value: new Decimal(0),
    };
  }

  if (value instanceof Decimal) {
    return {
      valid: value.isFinite(),
      value: value.isFinite() ? value : new Decimal(0),
    };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return {
        valid: false,
        value: new Decimal(0),
      };
    }

    const decimal = new Decimal(value.toString());

    return {
      valid: decimal.isFinite(),
      value: decimal.isFinite() ? decimal : new Decimal(0),
    };
  }

  if (typeof value === 'bigint') {
    return {
      valid: true,
      value: new Decimal(value.toString()),
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      value: new Decimal(0),
    };
  }

  const trimmed = value.trim();

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return {
      valid: false,
      value: new Decimal(0),
    };
  }

  try {
    const decimal = new Decimal(trimmed);

    return {
      valid: decimal.isFinite(),
      value: decimal.isFinite() ? decimal : new Decimal(0),
    };
  } catch {
    return {
      valid: false,
      value: new Decimal(0),
    };
  }
}

function parseIsoDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

function resolveDefaultCurrency(currency: string | undefined): string {
  return cleanCurrency(currency) ?? DEFAULT_CURRENCY;
}

function resolveLineCurrency(rawLine: Record<string, unknown>): string | null {
  const directCurrency = cleanCurrency(rawLine.currency);

  if (directCurrency !== null) {
    return directCurrency;
  }

  if (isRecord(rawLine.metadata)) {
    return cleanCurrency(rawLine.metadata.currency);
  }

  return null;
}

function cleanCurrency(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.trim().toUpperCase();

  return cleaned ? cleaned : null;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanOptionalText(value: unknown): string | undefined {
  const cleaned = cleanText(value);

  return cleaned ? cleaned : undefined;
}

function createError({
  code,
  message,
  field,
  details,
}: {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}): AccountingValidationError {
  const error: AccountingValidationError = {
    code,
    severity: 'error',
    message,
  };

  if (field !== undefined) {
    error.field = field;
  }

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function addEntryError(
  runtime: ValidationRuntime,
  entryIndex: number,
  input: {
    code: string;
    message: string;
    field?: string;
    details?: Record<string, unknown>;
  },
): void {
  runtime.errors.push(createError(input));
  runtime.entryIndexesWithErrors.add(entryIndex);
}

function addEntryWarning(
  runtime: ValidationRuntime,
  entryIndex: number,
  warning: AccountingValidationWarning,
): void {
  runtime.warnings.push(warning);
  runtime.entryIndexesWithWarnings.add(entryIndex);
}

function addWarningOnce(
  runtime: ValidationRuntime,
  key: string,
  entryIndex: number,
  warning: AccountingValidationWarning,
): void {
  if (runtime.warningKeys.has(key)) {
    return;
  }

  runtime.warningKeys.add(key);
  addEntryWarning(runtime, entryIndex, warning);
}

function isMissingAmount(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPES.includes(value as AccountType);
}

function isAccountingOperation(value: unknown): value is AccountingOperation {
  return typeof value === 'string' && SUPPORTED_OPERATIONS.includes(value as AccountingOperation);
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

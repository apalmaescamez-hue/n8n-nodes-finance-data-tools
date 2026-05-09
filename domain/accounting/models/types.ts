import type Decimal from 'decimal.js';
import type {
  AuditTrailEvent,
  NodeError,
  NodeSeverity,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from '../../../shared';

export type Severity = NodeSeverity;

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

export type AccountType = typeof ACCOUNT_TYPES[number];

export type AccountingOperation =
  | 'build_trial_balance'
  | 'validate_and_build_trial_balance'
  | 'validate_journal_entries';

export type DecimalInput = string | number | bigint;

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  currency?: string;
  active?: boolean;
}

export interface JournalLine {
  accountCode: string;
  debit: DecimalInput;
  credit: DecimalInput;
  currency?: string;
  description?: string;
  costCenter?: string;
  metadata?: Record<string, unknown>;
}

export interface JournalEntry {
  id: string;
  date: string;
  currency: string;
  description?: string;
  lines: JournalLine[];
}

export interface Ledger {
  entries: JournalEntry[];
}

export interface AccountingInput {
  accounts?: Account[];
  chartOfAccounts?: Account[];
  entries?: JournalEntry[];
  ledger?: Ledger;
}

export type BalanceSide = 'credit' | 'debit' | 'zero';

export interface TrialBalance {
  accountCode: string;
  accountName?: string;
  debitTotal: string;
  creditTotal: string;
  balance: string;
  balanceSide: BalanceSide;
}

export type AccountingValidationWarning = NodeWarning;

export type AccountingValidationError = NodeError;

export type AuditTrailEntry = AuditTrailEvent;

export type AccountingMetadata = StandardNodeMetadata;

export type ToolEnvelope<TData> = StandardNodeOutput<TData, AccountingMetadata>;

export interface AccountingValidationOptions {
  operation?: AccountingOperation;
  currency?: string;
  allowLineWithBothDebitAndCredit?: boolean;
  allowNegativeAmounts?: boolean;
  expectedPeriodStart?: string;
  expectedPeriodEnd?: string;
  includeTrialBalance?: boolean;
}

export interface AccountingValidationResult {
  isValid: boolean;
  entriesValidated: number;
  errors: AccountingValidationError[];
  warnings: AccountingValidationWarning[];
  auditTrail: AuditTrailEntry[];
  trialBalance?: TrialBalance[];
  summary: {
    accountCount: number;
    currency: string;
    entriesWithErrors: number;
    entriesWithWarnings: number;
    trialBalanceGenerated: boolean;
  };
}

export interface NormalizedJournalLine {
  accountCode: string;
  accountName?: string;
  accountType?: AccountType;
  debit: Decimal;
  credit: Decimal;
  currency: string;
  description?: string;
  costCenter?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedJournalEntry {
  entryIndex: number;
  id: string;
  date: string;
  currency: string;
  description?: string;
  lines: NormalizedJournalLine[];
  totalDebit: Decimal;
  totalCredit: Decimal;
}

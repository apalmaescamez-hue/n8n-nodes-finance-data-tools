import Decimal from 'decimal.js';

import type { Account, NormalizedJournalEntry, TrialBalance } from '../models/types';

interface TrialBalanceAccumulator {
  accountCode: string;
  accountName?: string;
  debitTotal: Decimal;
  creditTotal: Decimal;
}

export function buildTrialBalance(
  entries: NormalizedJournalEntry[],
  accountsByCode: ReadonlyMap<string, Account>,
): TrialBalance[] {
  const accumulators = new Map<string, TrialBalanceAccumulator>();

  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = accountsByCode.get(line.accountCode);
      const existing = accumulators.get(line.accountCode) ?? {
        accountCode: line.accountCode,
        accountName: account?.name ?? line.accountName,
        debitTotal: new Decimal(0),
        creditTotal: new Decimal(0),
      };

      existing.debitTotal = existing.debitTotal.plus(line.debit);
      existing.creditTotal = existing.creditTotal.plus(line.credit);
      accumulators.set(line.accountCode, existing);
    }
  }

  return [...accumulators.values()]
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode))
    .map((accumulator) => {
      const netBalance = accumulator.debitTotal.minus(accumulator.creditTotal);
      const balanceSide = netBalance.isZero()
        ? 'zero'
        : netBalance.isPositive()
          ? 'debit'
          : 'credit';

      const trialBalance: TrialBalance = {
        accountCode: accumulator.accountCode,
        debitTotal: formatDecimal(accumulator.debitTotal),
        creditTotal: formatDecimal(accumulator.creditTotal),
        balance: formatDecimal(netBalance.abs()),
        balanceSide,
      };

      if (accumulator.accountName !== undefined) {
        trialBalance.accountName = accumulator.accountName;
      }

      return trialBalance;
    });
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

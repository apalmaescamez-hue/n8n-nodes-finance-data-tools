import type { FinancialReportInput } from '../../domain/finance/reports';

export const fullFinancialReportFixture: FinancialReportInput = {
  currency: 'EUR',
  period: {
    label: 'FY 2026',
    start: '2026-01-01',
    end: '2026-12-31',
  },
  profitAndLoss: {
    revenue: '1000.00',
    cogs: '400.00',
    operatingExpenses: '250.00',
    otherIncome: '25.00',
    otherExpenses: '10.00',
    taxExpense: '15.00',
  },
  balanceSheet: {
    assets: {
      cash: '500.00',
      receivables: '300.00',
      equipment: '200.00',
    },
    liabilities: {
      accountsPayable: '250.00',
      debt: '150.00',
    },
    equity: {
      retainedEarnings: '600.00',
    },
  },
  cashFlow: {
    openingCash: '300.00',
    cashInflows: '450.00',
    cashOutflows: '250.00',
    closingCash: '500.00',
  },
  kpis: {
    customerCount: '25',
    runwayMonths: '6',
  },
  ratios: {
    gross_margin: {
      label: 'Gross Margin',
      value: '0.6',
    },
  },
};

export const unbalancedBalanceSheetFixture: FinancialReportInput = {
  currency: 'EUR',
  balanceSheet: {
    assets: {
      cash: '1000.00',
    },
    liabilities: {
      debt: '400.00',
    },
    equity: {
      capital: '500.00',
    },
  },
};

export const invalidProfitAndLossFixture: FinancialReportInput = {
  currency: 'EUR',
  profitAndLoss: {
    revenue: 'not-a-decimal',
    cogs: '400.00',
  },
};

export const numberInputFixture: FinancialReportInput = {
  currency: 'EUR',
  profitAndLoss: {
    revenue: 1000,
    cogs: '400.00',
    operatingExpenses: '250.00',
  },
};

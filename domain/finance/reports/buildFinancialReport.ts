import Decimal from 'decimal.js';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AgentInstructions,
  AuditTrailEntry,
  BuildFinancialReportOptions,
  DashboardCard,
  DashboardData,
  FinancialReportData,
  FinancialReportError,
  FinancialReportInput,
  FinancialReportOperation,
  FinancialReportPeriod,
  FinancialReportType,
  FinancialReportWarning,
  ReportMetric,
  ReportMetricUnit,
  ReportRow,
  ReportSection,
  ToolEnvelope,
} from './types';

const DEFAULT_OPERATION: FinancialReportOperation = 'build_financial_report';
const DEFAULT_REPORT_TYPE: FinancialReportType = 'executive_summary';
const DEFAULT_CURRENCY = 'EUR';

export const SUPPORTED_FINANCIAL_REPORT_TYPES: readonly FinancialReportType[] = [
  'ai_agent_report',
  'balance_sheet',
  'cash_summary',
  'dashboard_json',
  'executive_summary',
  'kpi_table',
  'profit_and_loss',
];

interface RuntimeState {
  currency: string;
  errors: FinancialReportError[];
  warnings: FinancialReportWarning[];
  warningKeys: Set<string>;
}

interface DecimalFieldResult {
  missing: boolean;
  valid: boolean;
  value: Decimal | null;
}

interface BuiltSectionResult {
  section: ReportSection;
  metrics: ReportMetric[];
}

interface ReportContext {
  currency: string;
  period: FinancialReportPeriod;
  reportType: FinancialReportType;
  sourceCompleteness: {
    sectionsPresent: string[];
    sectionsMissing: string[];
  };
}

export function buildFinancialReport(
  input: unknown,
  options: BuildFinancialReportOptions = {},
): ToolEnvelope<FinancialReportData> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const operation = options.operation ?? DEFAULT_OPERATION;
  const reportType = options.reportType ?? DEFAULT_REPORT_TYPE;
  const warnings: FinancialReportWarning[] = [];
  const errors: FinancialReportError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_validation',
      message: 'Financial report input received.',
      details: { requestedOperation: operation, requestedReportType: reportType },
    }),
  ];

  if (operation !== DEFAULT_OPERATION) {
    errors.push(createError({
      code: 'UNSUPPORTED_OPERATION',
      message: `Unsupported financial report operation: ${String(operation)}`,
      details: { supportedOperations: [DEFAULT_OPERATION] },
    }));
    return createFailureEnvelope({
      operation: String(operation),
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      errors,
      warnings,
      auditTrail,
      failureMessage: 'Financial report operation rejected.',
    });
  }

  if (!isFinancialReportType(reportType)) {
    errors.push(createError({
      code: 'UNSUPPORTED_REPORT_TYPE',
      message: `Unsupported financial report type: ${String(reportType)}`,
      field: 'reportType',
      details: { supportedReportTypes: SUPPORTED_FINANCIAL_REPORT_TYPES },
    }));
  }

  if (!isRecord(input)) {
    errors.push(createError({
      code: 'INVALID_INPUT',
      message: 'Expected one aggregated financial report object.',
      details: { receivedType: Array.isArray(input) ? 'array' : typeof input },
    }));
    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      errors,
      warnings,
      auditTrail,
      failureMessage: 'Financial report input validation failed.',
    });
  }

  const reportInput = input as FinancialReportInput;
  const currency = resolveCurrency(reportInput.currency, options.currency);
  const runtime: RuntimeState = { currency, errors, warnings, warningKeys: new Set<string>() };
  const period = resolvePeriod(reportInput.period, options.reportingPeriodLabel);
  const sourceCompleteness = detectSourceCompleteness(reportInput);

  auditTrail.push(createAuditTrailEvent({
    step: 'input_validation',
    message: 'Financial report input shape was validated.',
    details: {
      topLevelFieldCount: Object.keys(input).length,
      sectionsPresent: sourceCompleteness.sectionsPresent,
      sectionsMissing: sourceCompleteness.sectionsMissing,
    },
  }));
  auditTrail.push(createAuditTrailEvent({
    step: 'report_type_validation',
    message: errors.length === 0 ? 'Financial report type was validated.' : 'Financial report type validation failed.',
    details: { reportType, supportedReportTypes: SUPPORTED_FINANCIAL_REPORT_TYPES },
  }));

  if (errors.length > 0) {
    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 1,
      columnCount: Object.keys(input).length,
      errors,
      warnings,
      auditTrail,
      failureMessage: 'Financial report validation failed.',
    });
  }

  validateRequiredSourceForReport(reportType, sourceCompleteness, runtime);
  auditTrail.push(createAuditTrailEvent({
    step: 'financial_section_validation',
    message: runtime.errors.length === 0 ? 'Required financial sections are available.' : 'Required financial sections are missing.',
    details: { reportType, sectionsPresent: sourceCompleteness.sectionsPresent, errorCount: runtime.errors.length },
  }));

  if (runtime.errors.length > 0) {
    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 1,
      columnCount: Object.keys(input).length,
      errors,
      warnings,
      auditTrail,
      failureMessage: 'Financial report source validation failed.',
    });
  }

  const context: ReportContext = { currency, period, reportType, sourceCompleteness };
  const builtSections = buildSectionsForReport(reportInput, reportType, runtime);
  auditTrail.push(createAuditTrailEvent({
    step: 'metric_calculation',
    message: 'Financial report metrics were calculated.',
    details: {
      sectionCount: builtSections.length,
      metricCount: builtSections.reduce((total, built) => total + built.metrics.length, 0),
      warningCount: warnings.length,
      errorCount: errors.length,
    },
  }));

  if (errors.length > 0) {
    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 1,
      columnCount: Object.keys(input).length,
      errors,
      warnings,
      auditTrail,
      failureMessage: 'Financial report metric calculation failed.',
    });
  }

  const sections = builtSections.map((built) => built.section);
  const metrics = Object.fromEntries(builtSections.flatMap((built) => built.metrics).map((metric) => [metric.key, metric]));
  const data: FinancialReportData = {
    reportType,
    currency,
    period,
    title: buildReportTitle(reportType, period),
    executiveSummary: buildExecutiveSummary(metrics, context, warnings),
    sections,
    metrics,
    limitations: buildLimitations(reportType),
    sourceCompleteness,
  };

  if (reportType === 'ai_agent_report') data.agentInstructions = buildAgentInstructions(warnings);
  if (reportType === 'dashboard_json' || options.includeDashboardData === true) data.dashboard = buildDashboardData(metrics, sections);
  if (options.includeSourceData === true) data.sourceData = sanitizeSourceData(reportInput);

  auditTrail.push(createAuditTrailEvent({
    step: 'report_generation',
    message: 'Financial report output was generated.',
    details: {
      reportType,
      sectionCount: sections.length,
      dashboardIncluded: data.dashboard !== undefined,
      agentInstructionsIncluded: data.agentInstructions !== undefined,
    },
  }));
  auditTrail.push(createAuditTrailEvent({
    step: 'operation_completed',
    message: 'Financial report operation completed successfully.',
    details: { warningCount: warnings.length, errorCount: errors.length },
  }));

  return createSuccessOutput({
    operation,
    data,
    metadata: { rowCount: 1, columnCount: Object.keys(input).length, generatedAt, startedAt },
    warnings,
    errors,
    auditTrail,
  });
}
function buildSectionsForReport(input: FinancialReportInput, reportType: FinancialReportType, runtime: RuntimeState): BuiltSectionResult[] {
  const builders: BuiltSectionResult[] = [];
  const includeAllFinancialSections = reportType === 'ai_agent_report' || reportType === 'dashboard_json' || reportType === 'executive_summary';

  if ((includeAllFinancialSections || reportType === 'profit_and_loss') && isRecord(input.profitAndLoss)) builders.push(buildProfitAndLossSection(input.profitAndLoss, runtime));
  if ((includeAllFinancialSections || reportType === 'balance_sheet') && isRecord(input.balanceSheet)) builders.push(buildBalanceSheetSection(input.balanceSheet, runtime));
  if ((includeAllFinancialSections || reportType === 'cash_summary') && isRecord(input.cashFlow)) builders.push(buildCashSummarySection(input.cashFlow, runtime));
  if ((includeAllFinancialSections || reportType === 'kpi_table') && hasKpiSource(input)) builders.push(buildKpiSection(input, runtime));

  return builders;
}

function buildProfitAndLossSection(profitAndLoss: Record<string, unknown>, runtime: RuntimeState): BuiltSectionResult {
  const metrics: ReportMetric[] = [];
  const rows: ReportRow[] = [];
  const sectionWarnings: string[] = [];
  const revenue = readDecimal(profitAndLoss, 'revenue', 'Revenue', runtime, true);
  const cogs = readDecimal(profitAndLoss, 'cogs', 'COGS', runtime, false);
  const operatingExpenses = readDecimal(profitAndLoss, 'operatingExpenses', 'Operating Expenses', runtime, false);
  const otherIncome = readDecimal(profitAndLoss, 'otherIncome', 'Other Income', runtime, false);
  const otherExpenses = readDecimal(profitAndLoss, 'otherExpenses', 'Other Expenses', runtime, false);
  const taxExpense = readDecimal(profitAndLoss, 'taxExpense', 'Tax Expense', runtime, false);
  const reportedNetIncome = readDecimal(profitAndLoss, 'netIncome', 'Net Income', runtime, false);

  if (revenue.value !== null) addMoneyRow(rows, metrics, 'revenue', 'Revenue', revenue.value, 'profit_and_loss', runtime.currency);
  if (cogs.value !== null) addMoneyRow(rows, metrics, 'cogs', 'COGS', cogs.value, 'profit_and_loss', runtime.currency);

  const grossProfit = revenue.value !== null && cogs.value !== null ? revenue.value.minus(cogs.value) : null;
  if (grossProfit !== null) {
    addMoneyRow(rows, metrics, 'grossProfit', 'Gross Profit', grossProfit, 'profit_and_loss', runtime.currency);
    addMarginMetric(metrics, 'grossMargin', 'Gross Margin', grossProfit, revenue.value, 'profit_and_loss');
  } else sectionWarnings.push('Gross profit requires revenue and COGS.');

  if (operatingExpenses.value !== null) addMoneyRow(rows, metrics, 'operatingExpenses', 'Operating Expenses', operatingExpenses.value, 'profit_and_loss', runtime.currency);

  const operatingIncome = grossProfit !== null && operatingExpenses.value !== null ? grossProfit.minus(operatingExpenses.value) : null;
  if (operatingIncome !== null) {
    addMoneyRow(rows, metrics, 'operatingIncome', 'Operating Income', operatingIncome, 'profit_and_loss', runtime.currency);
    addMarginMetric(metrics, 'operatingMargin', 'Operating Margin', operatingIncome, revenue.value, 'profit_and_loss');
  } else sectionWarnings.push('Operating income requires gross profit and operating expenses.');

  const computedNetIncome = operatingIncome === null ? null : operatingIncome.plus(otherIncome.value ?? new Decimal(0)).minus(otherExpenses.value ?? new Decimal(0)).minus(taxExpense.value ?? new Decimal(0));
  const netIncome = reportedNetIncome.value ?? computedNetIncome;
  if (netIncome !== null) {
    addMoneyRow(rows, metrics, 'netIncome', 'Net Income', netIncome, 'profit_and_loss', runtime.currency);
    addMarginMetric(metrics, 'netMargin', 'Net Margin', netIncome, revenue.value, 'profit_and_loss');
  } else sectionWarnings.push('Net income requires either netIncome or enough fields to compute it.');

  if (reportedNetIncome.value !== null && computedNetIncome !== null && !reportedNetIncome.value.equals(computedNetIncome)) {
    addWarningOnce(runtime, 'NET_INCOME_RECONCILIATION_MISMATCH', {
      code: 'NET_INCOME_RECONCILIATION_MISMATCH',
      severity: 'warning',
      message: 'Reported netIncome differs from the net income computed from available P&L fields.',
      details: { computedNetIncome: formatDecimal(computedNetIncome), reportedNetIncome: formatDecimal(reportedNetIncome.value) },
    });
  }

  return { section: { id: 'profit_and_loss', title: 'Profit and Loss', rows, narrative: buildProfitAndLossNarrative(metrics), warnings: sectionWarnings }, metrics };
}

function buildBalanceSheetSection(balanceSheet: Record<string, unknown>, runtime: RuntimeState): BuiltSectionResult {
  const metrics: ReportMetric[] = [];
  const rows: ReportRow[] = [];
  const sectionWarnings: string[] = [];
  const assets = readBreakdownTotal(balanceSheet, 'assets', 'totalAssets', 'Assets', runtime, true);
  const liabilities = readBreakdownTotal(balanceSheet, 'liabilities', 'totalLiabilities', 'Liabilities', runtime, true);
  const equity = readBreakdownTotal(balanceSheet, 'equity', 'totalEquity', 'Equity', runtime, true);

  if (assets.value !== null) addMoneyRow(rows, metrics, 'totalAssets', 'Total Assets', assets.value, 'balance_sheet', runtime.currency);
  if (liabilities.value !== null) addMoneyRow(rows, metrics, 'totalLiabilities', 'Total Liabilities', liabilities.value, 'balance_sheet', runtime.currency);
  if (equity.value !== null) addMoneyRow(rows, metrics, 'totalEquity', 'Total Equity', equity.value, 'balance_sheet', runtime.currency);

  if (assets.value !== null && liabilities.value !== null && equity.value !== null) {
    const equationDifference = assets.value.minus(liabilities.value).minus(equity.value);
    addMoneyRow(rows, metrics, 'balanceEquationDifference', 'Balance Equation Difference', equationDifference, 'balance_sheet', runtime.currency);
    if (!equationDifference.isZero()) {
      addWarningOnce(runtime, 'BALANCE_SHEET_UNBALANCED', {
        code: 'BALANCE_SHEET_UNBALANCED',
        severity: 'warning',
        message: 'Balance sheet equation does not balance: assets must equal liabilities plus equity.',
        details: { difference: formatDecimal(equationDifference) },
      });
      sectionWarnings.push('Assets do not equal liabilities plus equity.');
    }
  }

  return { section: { id: 'balance_sheet', title: 'Balance Sheet', rows, narrative: buildBalanceSheetNarrative(metrics), warnings: sectionWarnings }, metrics };
}

function buildCashSummarySection(cashFlow: Record<string, unknown>, runtime: RuntimeState): BuiltSectionResult {
  const metrics: ReportMetric[] = [];
  const rows: ReportRow[] = [];
  const sectionWarnings: string[] = [];
  const openingCash = readDecimal(cashFlow, 'openingCash', 'Opening Cash', runtime, true);
  const cashInflows = readDecimal(cashFlow, 'cashInflows', 'Cash Inflows', runtime, true);
  const cashOutflows = readDecimal(cashFlow, 'cashOutflows', 'Cash Outflows', runtime, true);
  const reportedClosingCash = readDecimal(cashFlow, 'closingCash', 'Closing Cash', runtime, false);

  if (openingCash.value !== null) addMoneyRow(rows, metrics, 'openingCash', 'Opening Cash', openingCash.value, 'cash_summary', runtime.currency);
  if (cashInflows.value !== null) addMoneyRow(rows, metrics, 'cashInflows', 'Cash Inflows', cashInflows.value, 'cash_summary', runtime.currency);
  if (cashOutflows.value !== null) addMoneyRow(rows, metrics, 'cashOutflows', 'Cash Outflows', cashOutflows.value, 'cash_summary', runtime.currency);

  const netCashFlow = cashInflows.value !== null && cashOutflows.value !== null ? cashInflows.value.minus(cashOutflows.value) : null;
  if (netCashFlow !== null) addMoneyRow(rows, metrics, 'netCashFlow', 'Net Cash Flow', netCashFlow, 'cash_summary', runtime.currency);

  const expectedClosingCash = openingCash.value !== null && netCashFlow !== null ? openingCash.value.plus(netCashFlow) : null;
  const closingCash = reportedClosingCash.value ?? expectedClosingCash;
  if (closingCash !== null) addMoneyRow(rows, metrics, 'closingCash', 'Closing Cash', closingCash, 'cash_summary', runtime.currency);

  if (reportedClosingCash.value !== null && expectedClosingCash !== null && !reportedClosingCash.value.equals(expectedClosingCash)) {
    addWarningOnce(runtime, 'CASH_RECONCILIATION_MISMATCH', {
      code: 'CASH_RECONCILIATION_MISMATCH',
      severity: 'warning',
      message: 'Reported closingCash differs from openingCash + cashInflows - cashOutflows.',
      details: { expectedClosingCash: formatDecimal(expectedClosingCash), reportedClosingCash: formatDecimal(reportedClosingCash.value) },
    });
    sectionWarnings.push('Closing cash does not reconcile with opening cash and net cash flow.');
  }

  return { section: { id: 'cash_summary', title: 'Cash Summary', rows, narrative: buildCashNarrative(metrics), warnings: sectionWarnings }, metrics };
}
function buildKpiSection(input: FinancialReportInput, runtime: RuntimeState): BuiltSectionResult {
  const metrics: ReportMetric[] = [];
  const rows: ReportRow[] = [];

  if (Array.isArray(input.kpis)) {
    for (const rawKpi of input.kpis) {
      if (isRecord(rawKpi)) addKpiMetric({ rawKey: rawKpi.key, rawLabel: rawKpi.label, rawUnit: rawKpi.unit, rawValue: rawKpi.value, rows, metrics, runtime });
    }
  } else if (isRecord(input.kpis)) {
    for (const [key, value] of Object.entries(input.kpis)) addKpiMetric({ rawKey: key, rawLabel: key, rawUnit: undefined, rawValue: value, rows, metrics, runtime });
  }

  if (isRecord(input.ratios)) {
    for (const [key, value] of Object.entries(input.ratios)) {
      const ratioValue = isRecord(value) && 'value' in value ? value.value : value;
      const ratioLabel = isRecord(value) && typeof value.label === 'string' ? value.label : key;
      addKpiMetric({ rawKey: key, rawLabel: ratioLabel, rawUnit: 'decimal', rawValue: ratioValue, rows, metrics, runtime });
    }
  }

  return { section: { id: 'kpi_table', title: 'KPI Table', rows, narrative: [`${rows.length} KPI values prepared for reporting.`], warnings: [] }, metrics };
}

function addKpiMetric({ rawKey, rawLabel, rawUnit, rawValue, rows, metrics, runtime }: {
  rawKey: unknown;
  rawLabel: unknown;
  rawUnit: unknown;
  rawValue: unknown;
  rows: ReportRow[];
  metrics: ReportMetric[];
  runtime: RuntimeState;
}): void {
  const key = normalizeKey(cleanText(rawKey) || cleanText(rawLabel) || 'kpi');
  const label = cleanText(rawLabel) || key;
  const unit = normalizeMetricUnit(rawUnit);
  const parsed = parseDecimalValue(rawValue, runtime, `kpis.${key}`);
  const value = parsed.valid && parsed.value !== null ? formatDecimal(parsed.value) : cleanText(rawValue) || null;
  const resolvedUnit = parsed.valid && parsed.value !== null ? unit : 'text';
  const metric: ReportMetric = { key: `kpi.${key}`, label, value, unit: resolvedUnit, category: 'kpi_table' };

  metrics.push(metric);
  rows.push({ key: metric.key, label, value, unit: resolvedUnit, source: 'kpis' });
}

function validateRequiredSourceForReport(reportType: FinancialReportType, completeness: ReportContext['sourceCompleteness'], runtime: RuntimeState): void {
  const requiredByType: Partial<Record<FinancialReportType, string[]>> = {
    balance_sheet: ['balanceSheet'],
    cash_summary: ['cashFlow'],
    kpi_table: ['kpisOrRatios'],
    profit_and_loss: ['profitAndLoss'],
  };
  const required = requiredByType[reportType] ?? [];

  if (required.length === 0 && completeness.sectionsPresent.length === 0) {
    runtime.errors.push(createError({
      code: 'NO_REPORT_SOURCE_DATA',
      message: 'At least one financial source section is required to build a report.',
      details: { expectedAnyOf: ['profitAndLoss', 'balanceSheet', 'cashFlow', 'kpis', 'ratios'] },
    }));
    return;
  }

  for (const section of required) {
    if (!completeness.sectionsPresent.includes(section)) {
      runtime.errors.push(createError({
        code: 'MISSING_REPORT_SECTION',
        message: `Report type "${reportType}" requires source section "${section}".`,
        field: section,
      }));
    }
  }
}

function readDecimal(source: Record<string, unknown>, field: string, label: string, runtime: RuntimeState, required: boolean): DecimalFieldResult {
  const rawValue = source[field];

  if (isMissingValue(rawValue)) {
    if (required) runtime.errors.push(createError({ code: 'MISSING_REQUIRED_REPORT_FIELD', message: `${label} is required for this report section.`, field }));
    return { missing: true, valid: !required, value: null };
  }

  const parsed = parseDecimalValue(rawValue, runtime, field);
  if (!parsed.valid || parsed.value === null) {
    runtime.errors.push(createError({
      code: 'INVALID_DECIMAL_AMOUNT',
      message: `${label} must be a valid decimal amount.`,
      field,
      details: { value: rawValue },
    }));
  }

  return { missing: false, valid: parsed.valid, value: parsed.value };
}

function readBreakdownTotal(source: Record<string, unknown>, groupField: string, totalField: string, label: string, runtime: RuntimeState, required: boolean): DecimalFieldResult {
  const group = source[groupField];
  const explicitTotal = readDecimal(source, totalField, label, runtime, false);
  let breakdownTotal: Decimal | null = null;

  if (isRecord(group)) {
    breakdownTotal = new Decimal(0);
    for (const [key, rawValue] of Object.entries(group)) {
      if (key.toLowerCase().startsWith('total') || isMissingValue(rawValue)) continue;
      const parsed = parseDecimalValue(rawValue, runtime, `${groupField}.${key}`);
      if (!parsed.valid || parsed.value === null) {
        runtime.errors.push(createError({
          code: 'INVALID_DECIMAL_AMOUNT',
          message: `${label} breakdown field "${key}" must be a valid decimal amount.`,
          field: `${groupField}.${key}`,
          details: { value: rawValue },
        }));
        continue;
      }
      breakdownTotal = breakdownTotal.plus(parsed.value);
    }
  }

  if (breakdownTotal !== null && explicitTotal.value !== null && !breakdownTotal.equals(explicitTotal.value)) {
    addWarningOnce(runtime, `BREAKDOWN_TOTAL_MISMATCH:${totalField}`, {
      code: 'BREAKDOWN_TOTAL_MISMATCH',
      severity: 'warning',
      message: `${label} explicit total differs from the sum of its breakdown fields.`,
      field: totalField,
      details: { breakdownTotal: formatDecimal(breakdownTotal), explicitTotal: formatDecimal(explicitTotal.value) },
    });
  }

  const value = breakdownTotal ?? explicitTotal.value;
  if (value === null && required) runtime.errors.push(createError({ code: 'MISSING_REQUIRED_REPORT_FIELD', message: `${label} requires either ${groupField} breakdown or ${totalField}.`, field: groupField }));
  return { missing: value === null, valid: value !== null || !required, value };
}

function parseDecimalValue(value: unknown, runtime: RuntimeState, field: string): DecimalFieldResult {
  if (value instanceof Decimal) return { missing: false, valid: value.isFinite(), value: value.isFinite() ? value : null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { missing: false, valid: false, value: null };
    addWarningOnce(runtime, `NUMERIC_INPUT_AS_NUMBER:${field}`, { code: 'NUMERIC_INPUT_AS_NUMBER', severity: 'info', message: 'A numeric input arrived as JavaScript number; source precision may already be limited before decimal.js processing.', field });
    return { missing: false, valid: true, value: new Decimal(value.toString()) };
  }
  if (typeof value === 'bigint') return { missing: false, valid: true, value: new Decimal(value.toString()) };
  if (typeof value !== 'string') return { missing: false, valid: false, value: null };

  const trimmed = value.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return { missing: false, valid: false, value: null };

  try {
    const decimal = new Decimal(trimmed);
    return { missing: false, valid: decimal.isFinite(), value: decimal.isFinite() ? decimal : null };
  } catch {
    return { missing: false, valid: false, value: null };
  }
}
function addMoneyRow(rows: ReportRow[], metrics: ReportMetric[], key: string, label: string, value: Decimal, category: string, currency: string): void {
  const formattedValue = formatDecimal(value);
  const metric: ReportMetric = { key, label, value: formattedValue, unit: 'currency', category, details: { currency } };
  metrics.push(metric);
  rows.push({ key, label, value: formattedValue, unit: 'currency', source: category });
}

function addMarginMetric(metrics: ReportMetric[], key: string, label: string, numerator: Decimal, denominator: Decimal | null, category: string): void {
  if (denominator === null || denominator.isZero()) return;
  metrics.push({ key, label, value: formatDecimal(numerator.div(denominator)), unit: 'decimal', category });
}

function buildExecutiveSummary(metrics: Record<string, ReportMetric>, context: ReportContext, warnings: FinancialReportWarning[]): string[] {
  const summary: string[] = [];
  const periodLabel = context.period.label ?? 'selected period';
  if (metrics.revenue?.value !== undefined) summary.push(`Revenue for ${periodLabel}: ${metrics.revenue.value} ${context.currency}.`);
  if (metrics.netIncome?.value !== undefined) summary.push(`Net income: ${metrics.netIncome.value} ${context.currency}.`);
  if (metrics.totalAssets?.value !== undefined) summary.push(`Total assets: ${metrics.totalAssets.value} ${context.currency}.`);
  if (metrics.closingCash?.value !== undefined) summary.push(`Closing cash: ${metrics.closingCash.value} ${context.currency}.`);
  if (warnings.length > 0) summary.push(`${warnings.length} warning(s) require review before using this report for decisions.`);
  if (summary.length === 0) summary.push('Financial report generated from the available source sections. Review sections and warnings before drawing conclusions.');
  return summary;
}

function buildProfitAndLossNarrative(metrics: ReportMetric[]): string[] {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const narrative: string[] = [];
  if (byKey.has('grossProfit')) narrative.push('Gross profit was calculated as revenue minus COGS.');
  if (byKey.has('netIncome')) narrative.push('Net income was reported directly or computed from available P&L components.');
  return narrative;
}

function buildBalanceSheetNarrative(metrics: ReportMetric[]): string[] {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  return byKey.has('balanceEquationDifference') ? ['Balance equation check calculated as assets minus liabilities minus equity.'] : [];
}

function buildCashNarrative(metrics: ReportMetric[]): string[] {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  return byKey.has('netCashFlow') ? ['Net cash flow was calculated as cash inflows minus cash outflows.'] : [];
}

function buildDashboardData(metrics: Record<string, ReportMetric>, sections: ReportSection[]): DashboardData {
  const cardKeys = ['revenue', 'netIncome', 'totalAssets', 'closingCash', 'grossMargin', 'balanceEquationDifference'];
  const cards = cardKeys
    .map((key) => metrics[key])
    .filter((metric): metric is ReportMetric => metric !== undefined)
    .map((metric) => buildDashboardCard(metric));

  return { cards, tables: sections.map((section) => ({ id: section.id, title: section.title, rows: section.rows })) };
}

function buildDashboardCard(metric: ReportMetric): DashboardCard {
  let sentiment: DashboardCard['sentiment'] = 'neutral';
  if (metric.key === 'balanceEquationDifference' && metric.value !== null && metric.value !== '0') sentiment = 'warning';
  else if (metric.value !== null && metric.unit === 'currency' && metric.value.startsWith('-')) sentiment = 'negative';
  else if (metric.value !== null && metric.value !== '0') sentiment = 'positive';
  return { key: metric.key, title: metric.label, value: metric.value, unit: metric.unit, sentiment };
}

function buildAgentInstructions(warnings: FinancialReportWarning[]): AgentInstructions {
  return {
    canSummarize: true,
    mustMentionWarnings: warnings.length > 0,
    mustNotOverstateResults: true,
    recommendedPrompt: 'Summarize the financial report, mention warnings and limitations, and avoid presenting calculations as audited financial statements.',
  };
}

function buildLimitations(reportType: FinancialReportType): string[] {
  return [
    'This report is generated from provided JSON inputs and is not an audited financial statement.',
    'Calculations are deterministic and allowlisted; no arbitrary formulas are evaluated.',
    reportType === 'dashboard_json' ? 'Dashboard JSON is presentation-ready structure, not a visualization renderer.' : 'Interpretation still requires business context and accounting review.',
  ];
}

function buildReportTitle(reportType: FinancialReportType, period: FinancialReportPeriod): string {
  const titles: Record<FinancialReportType, string> = {
    ai_agent_report: 'AI Agent Financial Report',
    balance_sheet: 'Balance Sheet',
    cash_summary: 'Cash Summary',
    dashboard_json: 'Dashboard JSON Financial Report',
    executive_summary: 'Executive Financial Summary',
    kpi_table: 'Financial KPI Table',
    profit_and_loss: 'Profit and Loss Report',
  };
  const periodSuffix = period.label === undefined ? '' : ` - ${period.label}`;
  return `${titles[reportType]}${periodSuffix}`;
}

function createFailureEnvelope({ operation, generatedAt, startedAt, rowCount, columnCount, errors, warnings, auditTrail, failureMessage }: {
  operation: string;
  generatedAt: string;
  startedAt: number;
  rowCount: number;
  columnCount: number;
  errors: FinancialReportError[];
  warnings: FinancialReportWarning[];
  auditTrail: AuditTrailEntry[];
  failureMessage: string;
}): ToolEnvelope<FinancialReportData> {
  return createFailureOutput<FinancialReportData>({
    operation,
    data: null,
    metadata: { rowCount, columnCount, generatedAt, startedAt },
    warnings,
    errors,
    auditTrail: [...auditTrail, createAuditTrailEvent({ step: 'operation_completed', message: failureMessage, details: { errorCount: errors.length, warningCount: warnings.length } })],
  });
}
function detectSourceCompleteness(input: FinancialReportInput): ReportContext['sourceCompleteness'] {
  const sections = {
    balanceSheet: isRecord(input.balanceSheet),
    cashFlow: isRecord(input.cashFlow),
    kpisOrRatios: hasKpiSource(input),
    profitAndLoss: isRecord(input.profitAndLoss),
  };
  const sectionsPresent = Object.entries(sections).filter(([, present]) => present).map(([section]) => section);
  const sectionsMissing = Object.entries(sections).filter(([, present]) => !present).map(([section]) => section);
  return { sectionsPresent, sectionsMissing };
}

function hasKpiSource(input: FinancialReportInput): boolean {
  return (Array.isArray(input.kpis) && input.kpis.length > 0) ||
    (isRecord(input.kpis) && Object.keys(input.kpis).length > 0) ||
    (isRecord(input.ratios) && Object.keys(input.ratios).length > 0);
}

function resolveCurrency(inputCurrency: unknown, optionCurrency: string | undefined): string {
  return cleanText(optionCurrency || inputCurrency).toUpperCase() || DEFAULT_CURRENCY;
}

function resolvePeriod(inputPeriod: FinancialReportInput['period'], reportingPeriodLabel: string | undefined): FinancialReportPeriod {
  const label = cleanText(reportingPeriodLabel);
  if (label) return { label };
  if (typeof inputPeriod === 'string') {
    const periodLabel = inputPeriod.trim();
    return periodLabel ? { label: periodLabel } : {};
  }
  if (!isRecord(inputPeriod)) return {};

  const period: FinancialReportPeriod = {};
  const inputLabel = cleanText(inputPeriod.label);
  const start = cleanText(inputPeriod.start);
  const end = cleanText(inputPeriod.end);
  if (inputLabel) period.label = inputLabel;
  if (start) period.start = start;
  if (end) period.end = end;
  return period;
}

function sanitizeSourceData(input: FinancialReportInput): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function createError({ code, message, field, details }: {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}): FinancialReportError {
  const error: FinancialReportError = { code, severity: 'error', message };
  if (field !== undefined) error.field = field;
  if (details !== undefined) error.details = details;
  return error;
}

function addWarningOnce(runtime: RuntimeState, key: string, warning: FinancialReportWarning): void {
  if (runtime.warningKeys.has(key)) return;
  runtime.warningKeys.add(key);
  runtime.warnings.push(warning);
}

function normalizeMetricUnit(value: unknown): ReportMetricUnit {
  if (value === 'count' || value === 'currency' || value === 'decimal' || value === 'percentage' || value === 'text') return value;
  return 'decimal';
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'kpi';
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMissingValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinancialReportType(value: unknown): value is FinancialReportType {
  return typeof value === 'string' && SUPPORTED_FINANCIAL_REPORT_TYPES.includes(value as FinancialReportType);
}

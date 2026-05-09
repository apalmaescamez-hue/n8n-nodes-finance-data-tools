import Decimal from 'decimal.js';
import { z } from 'zod';

import { createAuditTrailEvent, createFailureOutput, createSuccessOutput } from '../../../shared';
import type {
  AuditTrailEntry,
  BurnRateSource,
  CalculateFinancialRatiosOptions,
  FinancialRatioDefinition,
  FinancialRatioKey,
  FinancialRatioResult,
  FinancialRatiosData,
  FinancialRatiosError,
  FinancialRatiosOperation,
  FinancialRatiosWarning,
  OmittedFinancialRatio,
  OmittedRatioReason,
  ToolEnvelope,
} from './types';

const inputSchema = z.record(z.string(), z.unknown());

export const SUPPORTED_FINANCIAL_RATIO_DEFINITIONS: readonly FinancialRatioDefinition[] = [
  {
    key: 'average_ticket',
    label: 'Average Ticket',
    category: 'efficiency',
    formula: 'revenue / transactionCount',
    requiredFields: ['revenue', 'transactionCount'],
    denominatorField: 'transactionCount',
    unit: 'currency_per_transaction',
    supportsPercentage: false,
    requiresContext: false,
  },
  {
    key: 'burn_rate',
    label: 'Burn Rate',
    category: 'cash_flow',
    formula: 'average(cashOutflows) or average(monthlyExpenses)',
    requiredFields: [],
    unit: 'currency_per_month',
    supportsPercentage: false,
    requiresContext: true,
  },
  {
    key: 'cash_ratio',
    label: 'Cash Ratio',
    category: 'liquidity',
    formula: 'cash / currentLiabilities',
    requiredFields: ['cash', 'currentLiabilities'],
    denominatorField: 'currentLiabilities',
    unit: 'decimal_ratio',
    supportsPercentage: false,
    requiresContext: false,
  },
  {
    key: 'current_ratio',
    label: 'Current Ratio',
    category: 'liquidity',
    formula: 'currentAssets / currentLiabilities',
    requiredFields: ['currentAssets', 'currentLiabilities'],
    denominatorField: 'currentLiabilities',
    unit: 'decimal_ratio',
    supportsPercentage: false,
    requiresContext: false,
  },
  {
    key: 'debt_to_ebitda',
    label: 'Debt to EBITDA',
    category: 'leverage',
    formula: 'totalDebt / ebitda',
    requiredFields: ['totalDebt', 'ebitda'],
    denominatorField: 'ebitda',
    unit: 'decimal_ratio',
    supportsPercentage: false,
    requiresContext: true,
  },
  {
    key: 'debt_to_equity',
    label: 'Debt to Equity',
    category: 'leverage',
    formula: 'totalDebt / equity',
    requiredFields: ['totalDebt', 'equity'],
    denominatorField: 'equity',
    unit: 'decimal_ratio',
    supportsPercentage: false,
    requiresContext: true,
  },
  {
    key: 'ebitda_margin',
    label: 'EBITDA Margin',
    category: 'profitability',
    formula: 'ebitda / revenue',
    requiredFields: ['ebitda', 'revenue'],
    denominatorField: 'revenue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: false,
  },
  {
    key: 'gross_margin',
    label: 'Gross Margin',
    category: 'profitability',
    formula: '(revenue - cogs) / revenue',
    requiredFields: ['revenue', 'cogs'],
    denominatorField: 'revenue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: false,
  },
  {
    key: 'ltv_cac',
    label: 'LTV/CAC',
    category: 'unit_economics',
    formula: 'ltv / cac',
    requiredFields: ['ltv', 'cac'],
    denominatorField: 'cac',
    unit: 'decimal_ratio',
    supportsPercentage: false,
    requiresContext: true,
  },
  {
    key: 'net_margin',
    label: 'Net Margin',
    category: 'profitability',
    formula: 'netIncome / revenue',
    requiredFields: ['netIncome', 'revenue'],
    denominatorField: 'revenue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: false,
  },
  {
    key: 'operating_margin',
    label: 'Operating Margin',
    category: 'profitability',
    formula: 'operatingIncome / revenue',
    requiredFields: ['operatingIncome', 'revenue'],
    denominatorField: 'revenue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: false,
  },
  {
    key: 'opex_ratio',
    label: 'Opex Ratio',
    category: 'efficiency',
    formula: 'operatingExpenses / revenue',
    requiredFields: ['operatingExpenses', 'revenue'],
    denominatorField: 'revenue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: false,
  },
  {
    key: 'quick_ratio',
    label: 'Quick Ratio',
    category: 'liquidity',
    formula: '(cash + receivables) / currentLiabilities',
    requiredFields: ['cash', 'receivables', 'currentLiabilities'],
    denominatorField: 'currentLiabilities',
    unit: 'decimal_ratio',
    supportsPercentage: false,
    requiresContext: false,
  },
  {
    key: 'revenue_growth',
    label: 'Revenue Growth',
    category: 'growth',
    formula: '(currentRevenue - previousRevenue) / previousRevenue',
    requiredFields: ['currentRevenue', 'previousRevenue'],
    denominatorField: 'previousRevenue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: true,
  },
  {
    key: 'roa',
    label: 'ROA',
    category: 'return',
    formula: 'netIncome / totalAssets',
    requiredFields: ['netIncome', 'totalAssets'],
    denominatorField: 'totalAssets',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: true,
  },
  {
    key: 'roe',
    label: 'ROE',
    category: 'return',
    formula: 'netIncome / equity',
    requiredFields: ['netIncome', 'equity'],
    denominatorField: 'equity',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: true,
  },
  {
    key: 'runway',
    label: 'Runway',
    category: 'cash_flow',
    formula: 'cash / burnRate',
    requiredFields: ['cash'],
    denominatorField: 'burnRate',
    unit: 'month',
    supportsPercentage: false,
    requiresContext: true,
  },
  {
    key: 'working_capital',
    label: 'Working Capital',
    category: 'liquidity',
    formula: 'currentAssets - currentLiabilities',
    requiredFields: ['currentAssets', 'currentLiabilities'],
    unit: 'currency',
    supportsPercentage: false,
    requiresContext: false,
  },
  {
    key: 'yoy_variation',
    label: 'YoY Variation',
    category: 'growth',
    formula: '(currentValue - previousYearValue) / previousYearValue',
    requiredFields: ['currentValue', 'previousYearValue'],
    denominatorField: 'previousYearValue',
    unit: 'decimal_ratio',
    supportsPercentage: true,
    requiresContext: true,
  },
];

export const SUPPORTED_FINANCIAL_RATIOS: readonly FinancialRatioKey[] =
  SUPPORTED_FINANCIAL_RATIO_DEFINITIONS.map((definition) => definition.key);

const RATIO_DEFINITIONS_BY_KEY = new Map(
  SUPPORTED_FINANCIAL_RATIO_DEFINITIONS.map((definition) => [definition.key, definition]),
);

const NON_NEGATIVE_FIELDS = new Set([
  'cac',
  'cash',
  'cogs',
  'currentAssets',
  'currentLiabilities',
  'currentRevenue',
  'ltv',
  'operatingExpenses',
  'previousRevenue',
  'previousYearValue',
  'receivables',
  'revenue',
  'totalAssets',
  'totalDebt',
  'transactionCount',
]);

const CONTEXTUAL_NEGATIVE_FIELDS = new Set([
  'ebitda',
  'equity',
  'netIncome',
  'operatingIncome',
]);

interface ParsedDecimalValue {
  parsed: boolean;
  value: Decimal | null;
}

interface DecimalFieldResult {
  status: 'invalid' | 'missing' | 'valid';
  value: Decimal | null;
}

interface DecimalSeriesResult {
  invalidCount: number;
  missing: boolean;
  values: Decimal[];
}

interface RuntimeState {
  warnings: FinancialRatiosWarning[];
  auditTrail: AuditTrailEntry[];
  warningKeys: Set<string>;
}

interface CollectedFields {
  invalidFields: string[];
  missingFields: string[];
  values: Record<string, Decimal>;
}

interface RatioCalculationSuccess {
  omitted: false;
  result: FinancialRatioResult;
}

interface RatioCalculationOmitted {
  omitted: true;
  omission: OmittedFinancialRatio;
}

type RatioCalculationOutcome = RatioCalculationSuccess | RatioCalculationOmitted;

export function calculateFinancialRatios(
  input: unknown,
  options: CalculateFinancialRatiosOptions = {},
): ToolEnvelope<FinancialRatiosData> {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const operation = options.operation ?? 'calculate_financial_ratios';
  const warnings: FinancialRatiosWarning[] = [];
  const errors: FinancialRatiosError[] = [];
  const auditTrail: AuditTrailEntry[] = [
    createAuditTrailEvent({
      timestamp: generatedAt,
      step: 'input_received',
      message: 'Financial ratio calculation started.',
      details: {
        requestedOperation: operation,
        requestedRatios: options.ratios ?? 'all',
      },
    }),
  ];

  if (!isFinancialRatiosOperation(operation)) {
    errors.push({
      code: 'UNSUPPORTED_OPERATION',
      severity: 'error',
      message: `Unsupported operation: ${String(operation)}`,
      details: {
        supportedOperations: ['calculate_financial_ratios'],
      },
    });

    return createFailureEnvelope({
      operation: String(operation),
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      warnings,
      errors,
      auditTrail,
      failureStep: 'operation_rejected',
      failureMessage: 'The requested Financial Ratios operation is not supported.',
    });
  }

  const requestedRatiosResult = resolveRequestedRatios(options.ratios);

  if (requestedRatiosResult.unsupportedRatios.length > 0) {
    errors.push({
      code: 'UNSUPPORTED_RATIO',
      severity: 'error',
      message: 'One or more requested financial ratios are not supported.',
      details: {
        unsupportedRatios: requestedRatiosResult.unsupportedRatios,
        supportedRatios: SUPPORTED_FINANCIAL_RATIOS,
      },
    });

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      warnings,
      errors,
      auditTrail,
      failureStep: 'ratio_rejected',
      failureMessage: 'Requested ratios failed allowlist validation.',
    });
  }

  if (!isPlainObject(input)) {
    errors.push({
      code: 'INVALID_INPUT',
      severity: 'error',
      message: 'Expected one aggregated financial object as input.',
      details: {
        receivedType: Array.isArray(input) ? 'array' : typeof input,
        datasetSupport: 'Dataset input is postponed in this first cut. Pass one aggregated object.',
      },
    });

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      warnings,
      errors,
      auditTrail,
      failureStep: 'validation_failed',
      failureMessage: 'Input validation failed.',
    });
  }

  const parsed = inputSchema.safeParse(input);

  if (!parsed.success) {
    errors.push({
      code: 'INVALID_INPUT',
      severity: 'error',
      message: 'Expected an aggregated JSON object with financial fields.',
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    });

    return createFailureEnvelope({
      operation,
      generatedAt,
      startedAt,
      rowCount: 0,
      columnCount: 0,
      warnings,
      errors,
      auditTrail,
      failureStep: 'validation_failed',
      failureMessage: 'Input validation failed.',
    });
  }

  const financialInput = parsed.data;
  const inputFields = Object.keys(financialInput).sort();
  const includePercentages = options.includePercentages ?? true;
  const burnRateSource = options.burnRateSource ?? 'auto';
  const runtime: RuntimeState = {
    warnings,
    auditTrail,
    warningKeys: new Set<string>(),
  };
  const currency = resolveCurrency(financialInput, options.currency, runtime);

  auditTrail.push(createAuditTrailEvent({
    step: 'input_validated',
    message: 'Aggregated financial input object was validated.',
    details: {
      fieldCount: inputFields.length,
      fields: inputFields,
    },
  }));

  const ratios: Partial<Record<FinancialRatioKey, FinancialRatioResult>> = {};
  const omittedRatios: OmittedFinancialRatio[] = [];

  for (const ratioKey of requestedRatiosResult.requestedRatios) {
    const definition = getRatioDefinition(ratioKey);

    auditTrail.push(createAuditTrailEvent({
      step: 'ratio_validation_started',
      message: `Validating inputs for ${definition.label}.`,
      details: {
        ratio: ratioKey,
        requiredFields: definition.requiredFields,
      },
    }));

    const outcome = calculateRatio({
      definition,
      input: financialInput,
      includePercentages,
      currency,
      burnRateSource,
      runtime,
    });

    if (outcome.omitted) {
      omittedRatios.push(outcome.omission);
      addOmissionWarnings(outcome.omission, runtime);
      auditTrail.push(createAuditTrailEvent({
        step: 'ratio_omitted',
        message: `${definition.label} was not calculated.`,
        details: outcome.omission,
      }));
      continue;
    }

    ratios[ratioKey] = outcome.result;
    addInterpretiveContextWarning(definition, runtime);
    auditTrail.push(createAuditTrailEvent({
      step: 'ratio_calculated',
      message: `${definition.label} was calculated.`,
      details: {
        ratio: ratioKey,
        value: outcome.result.value,
        percentage: outcome.result.percentage,
      },
    }));
  }

  const data: FinancialRatiosData = {
    currency,
    ratios,
    omittedRatios,
    summary: {
      requestedCount: requestedRatiosResult.requestedRatios.length,
      calculatedCount: Object.keys(ratios).length,
      omittedCount: omittedRatios.length,
    },
    inputFields,
    calculationOptions: {
      burnRateSource,
      includePercentages,
      requestedRatios: requestedRatiosResult.requestedRatios,
    },
    datasetSupport: {
      status: 'postponed',
      message: 'This first cut expects one aggregated financial object. Row-based dataset aggregation is documented as a next step.',
    },
  };

  auditTrail.push(createAuditTrailEvent({
    step: 'calculation_completed',
    message: 'Financial ratio calculation completed.',
    details: {
      calculatedCount: data.summary.calculatedCount,
      omittedCount: data.summary.omittedCount,
      warningCount: warnings.length,
    },
  }));

  return createSuccessOutput({
    operation,
    data,
    metadata: {
      rowCount: 1,
      columnCount: inputFields.length,
      generatedAt,
      startedAt,
    },
    warnings,
    errors,
    auditTrail,
  });
}

function calculateRatio({
  definition,
  input,
  includePercentages,
  currency,
  burnRateSource,
  runtime,
}: {
  definition: FinancialRatioDefinition;
  input: Record<string, unknown>;
  includePercentages: boolean;
  currency: string | null;
  burnRateSource: BurnRateSource;
  runtime: RuntimeState;
}): RatioCalculationOutcome {
  if (definition.key === 'burn_rate') {
    return calculateBurnRateRatio({
      definition,
      input,
      includePercentages,
      currency,
      burnRateSource,
      runtime,
    });
  }

  if (definition.key === 'runway') {
    return calculateRunwayRatio({
      definition,
      input,
      includePercentages,
      currency,
      burnRateSource,
      runtime,
    });
  }

  const collected = collectRequiredFields(input, definition.requiredFields, runtime);

  if (collected.missingFields.length > 0 || collected.invalidFields.length > 0) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: collected.missingFields.length > 0 ? 'missing_fields' : 'invalid_value',
        missingFields: collected.missingFields,
        details: {
          invalidFields: collected.invalidFields,
        },
      }),
    };
  }

  if (definition.denominatorField !== undefined) {
    const denominator = collected.values[definition.denominatorField];

    if (denominator.isZero()) {
      return {
        omitted: true,
        omission: createOmission(definition, {
          reason: 'zero_denominator',
          denominatorField: definition.denominatorField,
          missingFields: [],
        }),
      };
    }
  }

  const value = calculateStandardRatioValue(definition.key, collected.values);

  return {
    omitted: false,
    result: createRatioResult({
      definition,
      value,
      values: collected.values,
      includePercentages,
      currency,
    }),
  };
}

function calculateStandardRatioValue(
  ratio: FinancialRatioKey,
  values: Record<string, Decimal>,
): Decimal {
  switch (ratio) {
    case 'average_ticket':
      return values.revenue.div(values.transactionCount);
    case 'cash_ratio':
      return values.cash.div(values.currentLiabilities);
    case 'current_ratio':
      return values.currentAssets.div(values.currentLiabilities);
    case 'debt_to_ebitda':
      return values.totalDebt.div(values.ebitda);
    case 'debt_to_equity':
      return values.totalDebt.div(values.equity);
    case 'ebitda_margin':
      return values.ebitda.div(values.revenue);
    case 'gross_margin':
      return values.revenue.minus(values.cogs).div(values.revenue);
    case 'ltv_cac':
      return values.ltv.div(values.cac);
    case 'net_margin':
      return values.netIncome.div(values.revenue);
    case 'operating_margin':
      return values.operatingIncome.div(values.revenue);
    case 'opex_ratio':
      return values.operatingExpenses.div(values.revenue);
    case 'quick_ratio':
      return values.cash.plus(values.receivables).div(values.currentLiabilities);
    case 'revenue_growth':
      return values.currentRevenue.minus(values.previousRevenue).div(values.previousRevenue);
    case 'roa':
      return values.netIncome.div(values.totalAssets);
    case 'roe':
      return values.netIncome.div(values.equity);
    case 'working_capital':
      return values.currentAssets.minus(values.currentLiabilities);
    case 'yoy_variation':
      return values.currentValue.minus(values.previousYearValue).div(values.previousYearValue);
    case 'burn_rate':
    case 'runway':
      throw new Error(`Ratio ${ratio} is handled by a dedicated calculator.`);
  }
}

function calculateBurnRateRatio({
  definition,
  input,
  includePercentages,
  currency,
  burnRateSource,
  runtime,
}: {
  definition: FinancialRatioDefinition;
  input: Record<string, unknown>;
  includePercentages: boolean;
  currency: string | null;
  burnRateSource: BurnRateSource;
  runtime: RuntimeState;
}): RatioCalculationOutcome {
  const source = resolveConcreteBurnRateSource(input, burnRateSource);

  if (source === null) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'missing_fields',
        missingFields: ['cashOutflows or monthlyExpenses'],
      }),
    };
  }

  const series = collectDecimalSeries(input[source], source, runtime);

  if (series.missing) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'missing_fields',
        missingFields: [source],
      }),
    };
  }

  if (series.values.length === 0) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'invalid_value',
        missingFields: [],
        details: {
          invalidFields: [source],
          invalidCount: series.invalidCount,
        },
      }),
    };
  }

  const averageBurnRate = averageDecimals(series.values);

  if (averageBurnRate.lte(0)) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'non_positive_burn_rate',
        denominatorField: source,
        missingFields: [],
        details: {
          source,
          value: formatDecimal(averageBurnRate),
        },
      }),
    };
  }

  const values = {
    [source]: averageBurnRate,
  };

  return {
    omitted: false,
    result: createRatioResult({
      definition,
      value: averageBurnRate,
      values,
      includePercentages,
      currency,
      burnRateSource: source,
      extraInputs: {
        [`${source}Count`]: String(series.values.length),
      },
    }),
  };
}

function calculateRunwayRatio({
  definition,
  input,
  includePercentages,
  currency,
  burnRateSource,
  runtime,
}: {
  definition: FinancialRatioDefinition;
  input: Record<string, unknown>;
  includePercentages: boolean;
  currency: string | null;
  burnRateSource: BurnRateSource;
  runtime: RuntimeState;
}): RatioCalculationOutcome {
  const cash = getDecimalField(input, 'cash', runtime);
  const source = resolveConcreteBurnRateSource(input, burnRateSource);

  if (cash.status === 'missing' || source === null) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'missing_fields',
        missingFields: [
          ...(cash.status === 'missing' ? ['cash'] : []),
          ...(source === null ? ['cashOutflows or monthlyExpenses'] : []),
        ],
      }),
    };
  }

  if (cash.status === 'invalid' || cash.value === null) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'invalid_value',
        missingFields: [],
        details: {
          invalidFields: ['cash'],
        },
      }),
    };
  }

  const series = collectDecimalSeries(input[source], source, runtime);

  if (series.missing) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'missing_fields',
        missingFields: [source],
      }),
    };
  }

  if (series.values.length === 0) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'invalid_value',
        missingFields: [],
        details: {
          invalidFields: [source],
          invalidCount: series.invalidCount,
        },
      }),
    };
  }

  const averageBurnRate = averageDecimals(series.values);

  if (averageBurnRate.isZero()) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'zero_denominator',
        denominatorField: source,
        missingFields: [],
      }),
    };
  }

  if (averageBurnRate.lt(0)) {
    return {
      omitted: true,
      omission: createOmission(definition, {
        reason: 'non_positive_burn_rate',
        denominatorField: source,
        missingFields: [],
        details: {
          source,
          value: formatDecimal(averageBurnRate),
        },
      }),
    };
  }

  const value = cash.value.div(averageBurnRate);
  const values = {
    burnRate: averageBurnRate,
    cash: cash.value,
  };

  return {
    omitted: false,
    result: createRatioResult({
      definition,
      value,
      values,
      includePercentages,
      currency,
      burnRateSource: source,
      extraInputs: {
        [`${source}Count`]: String(series.values.length),
      },
    }),
  };
}

function collectRequiredFields(
  input: Record<string, unknown>,
  fields: string[],
  runtime: RuntimeState,
): CollectedFields {
  const values: Record<string, Decimal> = {};
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  for (const field of fields) {
    const parsed = getDecimalField(input, field, runtime);

    if (parsed.status === 'missing') {
      missingFields.push(field);
      continue;
    }

    if (parsed.status === 'invalid' || parsed.value === null) {
      invalidFields.push(field);
      continue;
    }

    values[field] = parsed.value;
  }

  return {
    invalidFields,
    missingFields,
    values,
  };
}

function getDecimalField(
  input: Record<string, unknown>,
  field: string,
  runtime: RuntimeState,
): DecimalFieldResult {
  const rawValue = input[field];

  if (isMissingValue(rawValue)) {
    return {
      status: 'missing',
      value: null,
    };
  }

  const parsed = parseDecimalValue(rawValue);

  if (!parsed.parsed || parsed.value === null) {
    addWarningOnce(runtime, `INVALID_NUMERIC_FIELD:${field}`, {
      code: 'INVALID_NUMERIC_FIELD',
      severity: 'warning',
      message: `Field "${field}" must be numeric to calculate requested ratios.`,
      field,
    });

    return {
      status: 'invalid',
      value: null,
    };
  }

  addNegativeValueWarningIfNeeded(field, parsed.value, runtime);

  return {
    status: 'valid',
    value: parsed.value,
  };
}

function collectDecimalSeries(
  value: unknown,
  field: string,
  runtime: RuntimeState,
): DecimalSeriesResult {
  if (isMissingValue(value)) {
    return {
      invalidCount: 0,
      missing: true,
      values: [],
    };
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const values: Decimal[] = [];
  let invalidCount = 0;

  for (const rawValue of rawValues) {
    const parsed = parseDecimalValue(rawValue);

    if (!parsed.parsed || parsed.value === null) {
      invalidCount += 1;
      continue;
    }

    addNegativeValueWarningIfNeeded(field, parsed.value, runtime);
    values.push(parsed.value);
  }

  if (invalidCount > 0) {
    addWarningOnce(runtime, `INVALID_NUMERIC_SERIES:${field}`, {
      code: 'INVALID_NUMERIC_FIELD',
      severity: 'warning',
      message: `Field "${field}" contains non-numeric values that were ignored.`,
      field,
      details: {
        invalidCount,
      },
    });
  }

  return {
    invalidCount,
    missing: false,
    values,
  };
}

function createRatioResult({
  definition,
  value,
  values,
  includePercentages,
  currency,
  burnRateSource,
  extraInputs = {},
}: {
  definition: FinancialRatioDefinition;
  value: Decimal;
  values: Record<string, Decimal>;
  includePercentages: boolean;
  currency: string | null;
  burnRateSource?: Exclude<BurnRateSource, 'auto'>;
  extraInputs?: Record<string, string>;
}): FinancialRatioResult {
  const ratioResult: FinancialRatioResult = {
    key: definition.key,
    label: definition.label,
    category: definition.category,
    formula: definition.formula,
    value: formatDecimal(value),
    unit: definition.unit,
    inputs: {
      ...Object.fromEntries(
        Object.entries(values).map(([field, decimal]) => [field, formatDecimal(decimal)]),
      ),
      ...extraInputs,
    },
    metadata: {
      currency: usesCurrency(definition.unit) ? currency : null,
      percentageIncluded: includePercentages && definition.supportsPercentage,
      requiresContext: definition.requiresContext,
    },
  };

  if (burnRateSource !== undefined) {
    ratioResult.metadata.burnRateSource = burnRateSource;
  }

  if (includePercentages && definition.supportsPercentage) {
    ratioResult.percentage = formatDecimal(value.mul(100));
    ratioResult.metadata.percentageScale = '0_to_100';
  }

  return ratioResult;
}

function createOmission(
  definition: FinancialRatioDefinition,
  input: {
    reason: OmittedRatioReason;
    missingFields: string[];
    denominatorField?: string;
    details?: Record<string, unknown>;
  },
): OmittedFinancialRatio {
  const omission: OmittedFinancialRatio = {
    key: definition.key,
    label: definition.label,
    category: definition.category,
    reason: input.reason,
    missingFields: input.missingFields,
  };

  if (input.denominatorField !== undefined) {
    omission.denominatorField = input.denominatorField;
  }

  if (input.details !== undefined) {
    omission.details = input.details;
  }

  return omission;
}

function addOmissionWarnings(omission: OmittedFinancialRatio, runtime: RuntimeState): void {
  if (omission.reason === 'missing_fields') {
    runtime.warnings.push({
      code: 'MISSING_REQUIRED_FIELDS',
      severity: 'warning',
      message: `${omission.label} was not calculated because required fields are missing.`,
      details: {
        ratio: omission.key,
        missingFields: omission.missingFields,
      },
    });
  }

  if (omission.reason === 'invalid_value') {
    runtime.warnings.push({
      code: 'INVALID_RATIO_INPUT',
      severity: 'warning',
      message: `${omission.label} was not calculated because one or more inputs are invalid.`,
      details: {
        ratio: omission.key,
        ...omission.details,
      },
    });
  }

  if (omission.reason === 'zero_denominator') {
    runtime.warnings.push({
      code: 'DENOMINATOR_ZERO',
      severity: 'warning',
      message: `${omission.label} was not calculated because the denominator is zero.`,
      field: omission.denominatorField,
      details: {
        ratio: omission.key,
        denominatorField: omission.denominatorField,
      },
    });
  }

  if (omission.reason === 'non_positive_burn_rate') {
    runtime.warnings.push({
      code: 'NON_POSITIVE_BURN_RATE',
      severity: 'warning',
      message: `${omission.label} was not calculated because burn rate must be greater than zero.`,
      field: omission.denominatorField,
      details: {
        ratio: omission.key,
        ...omission.details,
      },
    });
  }

  runtime.warnings.push({
    code: 'RATIO_NOT_CALCULATED',
    severity: 'warning',
    message: `${omission.label} was omitted from the result.`,
    details: {
      ratio: omission.key,
      reason: omission.reason,
    },
  });
}

function addInterpretiveContextWarning(
  definition: FinancialRatioDefinition,
  runtime: RuntimeState,
): void {
  if (!definition.requiresContext) {
    return;
  }

  runtime.warnings.push({
    code: 'RATIO_REQUIRES_CONTEXT',
    severity: 'info',
    message: `${definition.label} requires business context before drawing conclusions.`,
    details: {
      ratio: definition.key,
      category: definition.category,
    },
  });
}

function addNegativeValueWarningIfNeeded(
  field: string,
  value: Decimal,
  runtime: RuntimeState,
): void {
  if (!value.isNegative()) {
    return;
  }

  if (NON_NEGATIVE_FIELDS.has(field)) {
    addWarningOnce(runtime, `NEGATIVE_VALUE_UNUSUAL:${field}`, {
      code: 'NEGATIVE_VALUE_UNUSUAL',
      severity: 'warning',
      message: `Field "${field}" is negative, which is unusual for this ratio input.`,
      field,
      details: {
        value: formatDecimal(value),
      },
    });
    return;
  }

  if (CONTEXTUAL_NEGATIVE_FIELDS.has(field)) {
    addWarningOnce(runtime, `NEGATIVE_VALUE_REQUIRES_CONTEXT:${field}`, {
      code: 'NEGATIVE_VALUE_REQUIRES_CONTEXT',
      severity: 'info',
      message: `Field "${field}" is negative and changes ratio interpretation.`,
      field,
      details: {
        value: formatDecimal(value),
      },
    });
  }
}

function resolveCurrency(
  input: Record<string, unknown>,
  optionCurrency: string | undefined,
  runtime: RuntimeState,
): string | null {
  const currency = cleanText(optionCurrency) || cleanText(input.currency);

  if (!currency) {
    runtime.warnings.push({
      code: 'CURRENCY_NOT_PROVIDED',
      severity: 'warning',
      message: 'Currency was not provided. Currency-denominated ratios will include null currency metadata.',
      field: 'currency',
    });
    return null;
  }

  return currency.toUpperCase();
}

function resolveRequestedRatios(ratios: FinancialRatioKey[] | undefined): {
  requestedRatios: FinancialRatioKey[];
  unsupportedRatios: string[];
} {
  if (ratios === undefined || ratios.length === 0) {
    return {
      requestedRatios: [...SUPPORTED_FINANCIAL_RATIOS],
      unsupportedRatios: [],
    };
  }

  const requestedRatios: FinancialRatioKey[] = [];
  const unsupportedRatios: string[] = [];
  const seenRatios = new Set<FinancialRatioKey>();

  for (const ratio of ratios as unknown[]) {
    if (!isFinancialRatioKey(ratio)) {
      unsupportedRatios.push(String(ratio));
      continue;
    }

    if (!seenRatios.has(ratio)) {
      requestedRatios.push(ratio);
      seenRatios.add(ratio);
    }
  }

  return {
    requestedRatios,
    unsupportedRatios,
  };
}

function resolveConcreteBurnRateSource(
  input: Record<string, unknown>,
  source: BurnRateSource,
): Exclude<BurnRateSource, 'auto'> | null {
  if (source === 'cashOutflows' || source === 'monthlyExpenses') {
    return source;
  }

  if (!isMissingValue(input.cashOutflows)) {
    return 'cashOutflows';
  }

  if (!isMissingValue(input.monthlyExpenses)) {
    return 'monthlyExpenses';
  }

  return null;
}

function createFailureEnvelope({
  operation,
  generatedAt,
  startedAt,
  rowCount,
  columnCount,
  warnings,
  errors,
  auditTrail,
  failureStep,
  failureMessage,
}: {
  operation: string;
  generatedAt: string;
  startedAt: number;
  rowCount: number;
  columnCount: number;
  warnings: FinancialRatiosWarning[];
  errors: FinancialRatiosError[];
  auditTrail: AuditTrailEntry[];
  failureStep: string;
  failureMessage: string;
}): ToolEnvelope<FinancialRatiosData> {
  return createFailureOutput<FinancialRatiosData>({
    operation,
    data: null,
    metadata: {
      rowCount,
      columnCount,
      generatedAt,
      startedAt,
    },
    warnings,
    errors,
    auditTrail: [
      ...auditTrail,
      createAuditTrailEvent({
        step: failureStep,
        message: failureMessage,
      }),
    ],
  });
}

function getRatioDefinition(ratio: FinancialRatioKey): FinancialRatioDefinition {
  const definition = RATIO_DEFINITIONS_BY_KEY.get(ratio);

  if (definition === undefined) {
    throw new Error(`Unsupported ratio escaped validation: ${ratio}`);
  }

  return definition;
}

function averageDecimals(values: Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(values.length);
}

function usesCurrency(unit: FinancialRatioDefinition['unit']): boolean {
  return unit === 'currency' ||
    unit === 'currency_per_month' ||
    unit === 'currency_per_transaction';
}

function addWarningOnce(
  runtime: RuntimeState,
  key: string,
  warning: FinancialRatiosWarning,
): void {
  if (runtime.warningKeys.has(key)) {
    return;
  }

  runtime.warningKeys.add(key);
  runtime.warnings.push(warning);
}

function parseDecimalValue(value: unknown): ParsedDecimalValue {
  if (value instanceof Decimal) {
    return { parsed: value.isFinite(), value: value.isFinite() ? value : null };
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { parsed: true, value: new Decimal(value) }
      : { parsed: false, value: null };
  }

  if (typeof value === 'bigint') {
    return { parsed: true, value: new Decimal(value.toString()) };
  }

  if (typeof value !== 'string') {
    return { parsed: false, value: null };
  }

  const normalized = normalizeNumericString(value);

  if (normalized === null) {
    return { parsed: false, value: null };
  }

  try {
    const decimal = new Decimal(normalized);
    return { parsed: decimal.isFinite(), value: decimal.isFinite() ? decimal : null };
  } catch {
    return { parsed: false, value: null };
  }
}

function normalizeNumericString(input: string): string | null {
  let working = input.normalize('NFKC').replace(/\u00a0/g, ' ').trim();

  if (working === '') {
    return null;
  }

  const wrappedNegative = /^\((.*)\)$/.exec(working);
  let negative = false;

  if (wrappedNegative !== null) {
    negative = true;
    working = wrappedNegative[1].trim();
  }

  if (working.startsWith('-')) {
    negative = true;
    working = working.slice(1).trim();
  }

  working = working
    .replace(/[%€$£¥]/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!/^[\d.,]+$/.test(working)) {
    return null;
  }

  const decimalSeparator = resolveDecimalSeparator(working);
  const normalizedMagnitude = applyDecimalSeparator(working, decimalSeparator);

  if (normalizedMagnitude === null || !/^\d+(?:\.\d+)?$/.test(normalizedMagnitude)) {
    return null;
  }

  return negative ? `-${normalizedMagnitude}` : normalizedMagnitude;
}

function resolveDecimalSeparator(value: string): ',' | '.' | null {
  const lastCommaIndex = value.lastIndexOf(',');
  const lastDotIndex = value.lastIndexOf('.');

  if (lastCommaIndex >= 0 && lastDotIndex >= 0) {
    return lastCommaIndex > lastDotIndex ? ',' : '.';
  }

  if (lastCommaIndex >= 0) {
    return shouldTreatOnlySeparatorAsDecimal(value, ',') ? ',' : null;
  }

  if (lastDotIndex >= 0) {
    return shouldTreatOnlySeparatorAsDecimal(value, '.') ? '.' : null;
  }

  return null;
}

function shouldTreatOnlySeparatorAsDecimal(value: string, separator: ',' | '.'): boolean {
  const parts = value.split(separator);

  if (parts.length <= 1) {
    return false;
  }

  const lastPart = parts[parts.length - 1];

  return lastPart.length > 0 && lastPart.length !== 3;
}

function applyDecimalSeparator(value: string, decimalSeparator: ',' | '.' | null): string | null {
  if (decimalSeparator === null) {
    return value.replace(/[,.]/g, '');
  }

  const separatorIndex = value.lastIndexOf(decimalSeparator);

  if (separatorIndex < 0) {
    return value.replace(/[,.]/g, '');
  }

  const integerPart = value.slice(0, separatorIndex).replace(/[,.]/g, '');
  const decimalPart = value.slice(separatorIndex + 1);

  if (decimalPart === '' || /[,.]/.test(decimalPart)) {
    return null;
  }

  return `${integerPart}.${decimalPart}`;
}

function formatDecimal(value: Decimal, decimalPlaces = 12): string {
  const rounded = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toString();
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isFinancialRatiosOperation(value: unknown): value is FinancialRatiosOperation {
  return value === 'calculate_financial_ratios';
}

function isFinancialRatioKey(value: unknown): value is FinancialRatioKey {
  return typeof value === 'string' && SUPPORTED_FINANCIAL_RATIOS.includes(value as FinancialRatioKey);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingValue(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);
}

import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import {
  calculateFinancialRatios,
  SUPPORTED_FINANCIAL_RATIO_DEFINITIONS,
  SUPPORTED_FINANCIAL_RATIOS,
} from '../../domain/finance/ratios';
import type {
  BurnRateSource,
  CalculateFinancialRatiosOptions,
  FinancialRatioKey,
  FinancialRatiosOperation,
} from '../../domain/finance/ratios';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class FinancialRatios implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Financial Ratios',
    name: 'financialRatios',
    icon: 'file:financialRatios.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Calculate allowlisted financial ratios from one aggregated financial object.',
    defaults: {
      name: 'Financial Ratios',
    },
    usableAsTool: true,
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Calculate Financial Ratios',
            value: 'calculate_financial_ratios',
            description: 'Calculate selected financial ratios from one aggregated input object',
            action: 'Calculate financial ratios',
          },
        ],
        default: 'calculate_financial_ratios',
      },
      {
        displayName: 'Burn Rate Source',
        name: 'burnRateSource',
        type: 'options',
        options: [
          {
            name: 'Auto',
            value: 'auto',
          },
          {
            name: 'Cash Outflows',
            value: 'cashOutflows',
          },
          {
            name: 'Monthly Expenses',
            value: 'monthlyExpenses',
          },
        ],
        default: 'auto',
        description: 'Source used for burn rate and runway. Auto uses cashOutflows first, then monthlyExpenses.',
      },
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'string',
        default: '',
        description: 'Optional ISO currency override. If empty, the node reads the input currency field.',
      },
      {
        displayName: 'Include Percentage Fields',
        name: 'includePercentages',
        type: 'boolean',
        default: true,
        description: 'Whether margin, return, growth, and opex ratios should also include percentage strings',
      },
      {
        displayName: 'Ratios',
        name: 'ratios',
        type: 'multiOptions',
        options: SUPPORTED_FINANCIAL_RATIO_DEFINITIONS.map((definition) => ({
          name: definition.label,
          value: definition.key,
          description: definition.formula,
        })),
        default: [...SUPPORTED_FINANCIAL_RATIOS],
        description: 'Closed allowlist of ratios to calculate. No arbitrary formulas are accepted.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));
    let operation: FinancialRatiosOperation = 'calculate_financial_ratios';

    try {
      operation = this.getNodeParameter('operation', 0) as FinancialRatiosOperation;
      const input = items.length === 1 ? items[0].json : items.map((item) => item.json);
      const options: CalculateFinancialRatiosOptions = {
        operation,
        burnRateSource: this.getNodeParameter('burnRateSource', 0, 'auto') as BurnRateSource,
        currency: this.getNodeParameter('currency', 0, '') as string,
        includePercentages: this.getNodeParameter('includePercentages', 0, true) as boolean,
        ratios: this.getNodeParameter(
          'ratios',
          0,
          [...SUPPORTED_FINANCIAL_RATIOS],
        ) as FinancialRatioKey[],
      };
      const result = calculateFinancialRatios(input, options);

      return [[{ json: result as unknown as IDataObject, pairedItem }]];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.continueOnFail()) {
        throw new NodeOperationError(this.getNode(), message);
      }

      const failureEnvelope = createFailureOutput({
        operation,
        metadata: {
          generatedAt: new Date().toISOString(),
          durationMs: 0,
          rowCount: items.length,
          columnCount: 0,
        },
        warnings: [],
        errors: [
          createNodeError({
            code: 'EXECUTION_ERROR',
            severity: 'error',
            message,
          }),
        ],
        auditTrail: [
          createAuditTrailEvent({
            step: 'execution_failed',
            message: 'Financial Ratios execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}

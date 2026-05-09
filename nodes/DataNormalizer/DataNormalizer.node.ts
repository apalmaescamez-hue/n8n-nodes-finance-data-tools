import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { normalizeDataset } from '../../domain/data/normalization';
import type { NormalizeDatasetOptions, PercentageOutputMode } from '../../domain/data/normalization';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class DataNormalizer implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Data Normalizer',
    name: 'dataNormalizer',
    icon: 'file:dataNormalizer.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Normalize finance datasets into canonical columns and value formats.',
    defaults: {
      name: 'Data Normalizer',
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
            name: 'Normalize Dataset',
            value: 'normalizeDataset',
            description: 'Normalize input items as rows and return one normalization envelope',
            action: 'Normalize the input dataset',
          },
        ],
        default: 'normalizeDataset',
      },
      {
        displayName: 'Add Currency Column',
        name: 'addCurrencyColumn',
        type: 'boolean',
        default: true,
        description: 'Whether to normalize or create the configured currency column using the default currency',
      },
      {
        displayName: 'Accounting Period Column',
        name: 'accountingPeriodColumn',
        type: 'string',
        default: 'accountingPeriod',
        description: 'Column where the generated accounting period in YYYY-MM format should be written',
      },
      {
        displayName: 'Accounting Period Date Column',
        name: 'accountingPeriodDateColumn',
        type: 'string',
        default: '',
        description: 'Date column used to generate the accounting period. Leave empty to skip period generation.',
      },
      {
        displayName: 'Amount Columns',
        name: 'amountColumns',
        type: 'string',
        default: '',
        description: 'Comma-separated columns to normalize to decimal strings, for example amount,total',
      },
      {
        displayName: 'Category Columns',
        name: 'categoryColumns',
        type: 'string',
        default: '',
        description: 'Comma-separated category columns to trim and collapse repeated whitespace',
      },
      {
        displayName: 'Column Mapping',
        name: 'columnMapping',
        type: 'json',
        default: '{}',
        description: 'JSON object mapping source column names to canonical names, for example {"importe":"amount"}',
      },
      {
        displayName: 'Currency Column',
        name: 'currencyColumn',
        type: 'string',
        default: 'currency',
        displayOptions: {
          show: {
            addCurrencyColumn: [true],
          },
        },
        description: 'Column to normalize or create with an ISO currency code',
      },
      {
        displayName: 'Date Columns',
        name: 'dateColumns',
        type: 'string',
        default: '',
        description: 'Comma-separated date columns to normalize to ISO date format YYYY-MM-DD',
      },
      {
        displayName: 'Default Currency',
        name: 'defaultCurrency',
        type: 'string',
        default: 'EUR',
        displayOptions: {
          show: {
            addCurrencyColumn: [true],
          },
        },
        description: 'Default ISO currency code used when the currency column is missing or blank',
      },
      {
        displayName: 'Percentage Columns',
        name: 'percentageColumns',
        type: 'string',
        default: '',
        description: 'Comma-separated percentage columns to normalize',
      },
      {
        displayName: 'Percentage Output Mode',
        name: 'percentageOutputMode',
        type: 'options',
        options: [
          {
            name: 'Percent String',
            value: 'percentString',
          },
          {
            name: 'Ratio Decimal String',
            value: 'ratioDecimalString',
          },
        ],
        default: 'ratioDecimalString',
        description: 'Whether percentages should be emitted as decimal ratios or percent strings',
      },
      {
        displayName: 'Rename Columns',
        name: 'renameColumns',
        type: 'json',
        default: '{}',
        description: 'JSON object with additional rename rules applied after column mapping',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));

    try {
      const operation = this.getNodeParameter('operation', 0) as string;

      if (operation !== 'normalizeDataset') {
        const unsupportedOperation = createFailureOutput({
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
              code: 'UNSUPPORTED_OPERATION',
              severity: 'error',
              message: `Unsupported operation: ${operation}`,
            }),
          ],
          auditTrail: [
            createAuditTrailEvent({
              step: 'operation_rejected',
              message: 'The requested Data Normalizer operation is not supported.',
            }),
          ],
        });

        return [[{ json: unsupportedOperation as IDataObject, pairedItem }]];
      }

      const options: NormalizeDatasetOptions = {
        addCurrencyColumn: this.getNodeParameter('addCurrencyColumn', 0, true) as boolean,
        accountingPeriodColumn: this.getNodeParameter(
          'accountingPeriodColumn',
          0,
          'accountingPeriod',
        ) as string,
        accountingPeriodDateColumn: this.getNodeParameter(
          'accountingPeriodDateColumn',
          0,
          '',
        ) as string,
        amountColumns: parseCommaSeparatedList(this.getNodeParameter('amountColumns', 0, '') as string),
        categoryColumns: parseCommaSeparatedList(
          this.getNodeParameter('categoryColumns', 0, '') as string,
        ),
        columnMapping: parseJsonObjectParameter(
          this.getNodeParameter('columnMapping', 0, '{}'),
          'Column Mapping',
        ),
        currencyColumn: this.getNodeParameter('currencyColumn', 0, 'currency') as string,
        dateColumns: parseCommaSeparatedList(this.getNodeParameter('dateColumns', 0, '') as string),
        defaultCurrency: this.getNodeParameter('defaultCurrency', 0, 'EUR') as string,
        percentageColumns: parseCommaSeparatedList(
          this.getNodeParameter('percentageColumns', 0, '') as string,
        ),
        percentageOutputMode: this.getNodeParameter(
          'percentageOutputMode',
          0,
          'ratioDecimalString',
        ) as PercentageOutputMode,
        renameColumns: parseJsonObjectParameter(
          this.getNodeParameter('renameColumns', 0, '{}'),
          'Rename Columns',
        ),
      };
      const rows = items.map((item) => item.json);
      const result = normalizeDataset(rows, options);

      return [[{ json: result as unknown as IDataObject, pairedItem }]];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.continueOnFail()) {
        throw new NodeOperationError(this.getNode(), message);
      }

      const failureEnvelope = createFailureOutput({
        operation: 'normalizeDataset',
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
            message: 'Data Normalizer execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseJsonObjectParameter(value: unknown, parameterName: string): Record<string, string> {
  const parsedValue = typeof value === 'string' ? JSON.parse(value) as unknown : value;

  if (!isPlainObject(parsedValue)) {
    throw new ApplicationError(`${parameterName} must be a JSON object.`);
  }

  return Object.entries(parsedValue).reduce<Record<string, string>>((mapping, [source, target]) => {
    mapping[source] = String(target);
    return mapping;
  }, {});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

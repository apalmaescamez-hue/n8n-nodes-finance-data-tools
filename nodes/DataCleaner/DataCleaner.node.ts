import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { cleanDataset } from '../../domain/data/cleaning';
import type {
  CleanDatasetOptions,
  ColumnNameStyle,
  DeduplicateBy,
  StringCaseMode,
} from '../../domain/data/cleaning';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

type NullReplacementMode = 'null' | 'emptyString' | 'zero';

export class DataCleaner implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Data Cleaner',
    name: 'dataCleaner',
    icon: 'file:dataCleaner.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Clean tabular JSON data before finance analysis.',
    defaults: {
      name: 'Data Cleaner',
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
            name: 'Clean Dataset',
            value: 'cleanDataset',
            description: 'Clean input items as rows and return one cleaning envelope',
            action: 'Clean the input dataset',
          },
        ],
        default: 'cleanDataset',
      },
      {
        displayName: 'Normalize Column Names',
        name: 'normalizeColumnNames',
        type: 'boolean',
        default: true,
        description: 'Whether column names should be normalized before values are cleaned',
      },
      {
        displayName: 'Column Name Style',
        name: 'columnNameStyle',
        type: 'options',
        displayOptions: {
          show: {
            normalizeColumnNames: [true],
          },
        },
        options: [
          {
            name: 'Camel Case',
            value: 'camelCase',
          },
          {
            name: 'Lower Case With Spaces',
            value: 'lowerCase',
          },
          {
            name: 'Snake Case',
            value: 'snakeCase',
          },
        ],
        default: 'snakeCase',
        description: 'How normalized column names should be formatted',
      },
      {
        displayName: 'Trim Strings',
        name: 'trimStrings',
        type: 'boolean',
        default: true,
        description: 'Whether leading and trailing whitespace should be removed from string values',
      },
      {
        displayName: 'Collapse Repeated Whitespace',
        name: 'collapseWhitespace',
        type: 'boolean',
        default: true,
        description: 'Whether repeated internal whitespace should be collapsed to one space',
      },
      {
        displayName: 'String Case',
        name: 'stringCase',
        type: 'options',
        options: [
          {
            name: 'Lowercase',
            value: 'lower',
          },
          {
            name: 'Preserve',
            value: 'preserve',
          },
          {
            name: 'Uppercase',
            value: 'upper',
          },
        ],
        default: 'preserve',
        description: 'Optional case normalization for string values after other string cleanup',
      },
      {
        displayName: 'Treat Configured Nulls as Null',
        name: 'treatConfiguredNullsAsNull',
        type: 'boolean',
        default: true,
        description: 'Whether configured null-like values should be replaced consistently',
      },
      {
        displayName: 'Null Values',
        name: 'nullValues',
        type: 'string',
        default: ',NULL,null,N/A,NA,-',
        displayOptions: {
          show: {
            treatConfiguredNullsAsNull: [true],
          },
        },
        description: 'Comma-separated string tokens that should be treated as null-like values',
      },
      {
        displayName: 'Null Replacement',
        name: 'nullReplacement',
        type: 'options',
        displayOptions: {
          show: {
            treatConfiguredNullsAsNull: [true],
          },
        },
        options: [
          {
            name: 'Empty String',
            value: 'emptyString',
          },
          {
            name: 'Null',
            value: 'null',
          },
          {
            name: 'Zero',
            value: 'zero',
          },
        ],
        default: 'null',
        description: 'Value used when a null-like value is found',
      },
      {
        displayName: 'Clean Currency Symbols',
        name: 'cleanCurrencySymbols',
        type: 'boolean',
        default: false,
        description: 'Whether currency symbols should be removed from number-like strings',
      },
      {
        displayName: 'Convert European Numbers',
        name: 'convertEuropeanNumbers',
        type: 'boolean',
        default: false,
        description: 'Whether European-formatted numbers such as 1.234,56 should be converted',
      },
      {
        displayName: 'Numeric Columns',
        name: 'numericColumns',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            convertEuropeanNumbers: [true],
          },
        },
        description:
          'Optional comma-separated columns where numeric conversion must be attempted. Leave empty to convert only number-like values.',
      },
      {
        displayName: 'Remove Empty Columns',
        name: 'removeEmptyColumns',
        type: 'boolean',
        default: false,
        description: 'Whether columns containing only null-like values should be removed',
      },
      {
        displayName: 'Remove Duplicates',
        name: 'removeDuplicates',
        type: 'boolean',
        default: false,
        description: 'Whether duplicate rows should be removed',
      },
      {
        displayName: 'Deduplicate By',
        name: 'deduplicateBy',
        type: 'options',
        displayOptions: {
          show: {
            removeDuplicates: [true],
          },
        },
        options: [
          {
            name: 'Configured Keys',
            value: 'keys',
          },
          {
            name: 'Full Row',
            value: 'fullRow',
          },
        ],
        default: 'fullRow',
        description: 'How duplicate rows should be identified',
      },
      {
        displayName: 'Deduplication Keys',
        name: 'deduplicateKeys',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            removeDuplicates: [true],
            deduplicateBy: ['keys'],
          },
        },
        description: 'Comma-separated column names used to identify duplicates when deduplicating by keys',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));

    try {
      const operation = this.getNodeParameter('operation', 0) as string;

      if (operation !== 'cleanDataset') {
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
              message: 'The requested Data Cleaner operation is not supported.',
            }),
          ],
        });

        return [[{ json: unsupportedOperation as IDataObject, pairedItem }]];
      }

      const options: CleanDatasetOptions = {
        normalizeColumnNames: this.getNodeParameter('normalizeColumnNames', 0, true) as boolean,
        columnNameStyle: this.getNodeParameter('columnNameStyle', 0, 'snakeCase') as ColumnNameStyle,
        trimStrings: this.getNodeParameter('trimStrings', 0, true) as boolean,
        collapseWhitespace: this.getNodeParameter('collapseWhitespace', 0, true) as boolean,
        stringCase: this.getNodeParameter('stringCase', 0, 'preserve') as StringCaseMode,
        treatConfiguredNullsAsNull: this.getNodeParameter(
          'treatConfiguredNullsAsNull',
          0,
          true,
        ) as boolean,
        nullValues: parseCommaSeparatedList(this.getNodeParameter('nullValues', 0, '') as string),
        nullReplacement: resolveNullReplacement(
          this.getNodeParameter('nullReplacement', 0, 'null') as NullReplacementMode,
        ),
        cleanCurrencySymbols: this.getNodeParameter('cleanCurrencySymbols', 0, false) as boolean,
        convertEuropeanNumbers: this.getNodeParameter('convertEuropeanNumbers', 0, false) as boolean,
        numericColumns: parseCommaSeparatedList(
          this.getNodeParameter('numericColumns', 0, '') as string,
        ),
        removeEmptyColumns: this.getNodeParameter('removeEmptyColumns', 0, false) as boolean,
        removeDuplicates: this.getNodeParameter('removeDuplicates', 0, false) as boolean,
        deduplicateBy: this.getNodeParameter('deduplicateBy', 0, 'fullRow') as DeduplicateBy,
        deduplicateKeys: parseCommaSeparatedList(
          this.getNodeParameter('deduplicateKeys', 0, '') as string,
        ),
      };
      const rows = items.map((item) => item.json);
      const result = cleanDataset(rows, options);

      return [[{ json: result as unknown as IDataObject, pairedItem }]];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.continueOnFail()) {
        throw new NodeOperationError(this.getNode(), message);
      }

      const failureEnvelope = createFailureOutput({
        operation: 'cleanDataset',
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
            message: 'Data Cleaner execution failed, but continueOnFail is enabled.',
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
    .filter((entry, index) => entry.length > 0 || (index === 0 && value.startsWith(',')));
}

function resolveNullReplacement(mode: NullReplacementMode): string | number | null {
  if (mode === 'emptyString') {
    return '';
  }

  if (mode === 'zero') {
    return 0;
  }

  return null;
}

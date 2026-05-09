import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { profileDataset } from '../../domain/data/profiling';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class DataProfiler implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Data Profiler',
    name: 'dataProfiler',
    icon: 'file:dataProfiler.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Profile tabular JSON data before finance data preparation.',
    defaults: {
      name: 'Data Profiler',
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
            name: 'Profile Dataset',
            value: 'profileDataset',
            description: 'Analyze input items as rows and return one profiling envelope',
            action: 'Profile the input dataset',
          },
        ],
        default: 'profileDataset',
      },
      {
        displayName: 'Treat Empty Strings as Null',
        name: 'treatEmptyStringAsNull',
        type: 'boolean',
        default: true,
        description: 'Whether blank strings should count as null values in data-quality metrics',
      },
      {
        displayName: 'Coerce Numeric Strings',
        name: 'coerceNumericStrings',
        type: 'boolean',
        default: true,
        description: 'Whether numeric-looking strings should be treated as numbers for profiling',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));

    try {
      const operation = this.getNodeParameter('operation', 0) as string;

      if (operation !== 'profileDataset') {
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
              message: 'The requested Data Profiler operation is not supported.',
            }),
          ],
        });

        return [[{ json: unsupportedOperation as IDataObject, pairedItem }]];
      }

      const treatEmptyStringAsNull = this.getNodeParameter(
        'treatEmptyStringAsNull',
        0,
        true,
      ) as boolean;
      const coerceNumericStrings = this.getNodeParameter(
        'coerceNumericStrings',
        0,
        true,
      ) as boolean;
      const rows = items.map((item) => item.json);
      const result = profileDataset(rows, {
        treatEmptyStringAsNull,
        coerceNumericStrings,
      });

      return [[{ json: result as unknown as IDataObject, pairedItem }]];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.continueOnFail()) {
        throw new NodeOperationError(this.getNode(), message);
      }

      const failureEnvelope = createFailureOutput({
        operation: 'profileDataset',
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
            message: 'Data Profiler execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}

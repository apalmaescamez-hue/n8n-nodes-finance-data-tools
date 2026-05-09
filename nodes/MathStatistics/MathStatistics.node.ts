import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { calculateStatistics } from '../../domain/math/statistics';
import type {
  CalculateStatisticsOptions,
  GroupAggregation,
  GrowthRateMode,
  MathStatisticsOperation,
} from '../../domain/math/statistics';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class MathStatistics implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Math & Statistics',
    name: 'mathStatistics',
    icon: 'file:mathStatistics.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Calculate safe allowlisted math and statistics operations for finance datasets.',
    defaults: {
      name: 'Math & Statistics',
    },
    usableAsTool: true,
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Descriptive Statistic',
            value: 'descriptiveStatistic',
          },
          {
            name: 'Finance Math',
            value: 'financeMath',
          },
          {
            name: 'Group Aggregate',
            value: 'group_aggregate',
          },
          {
            name: 'Outlier Analysis',
            value: 'outlierAnalysis',
          },
          {
            name: 'Relationship',
            value: 'relationship',
          },
        ],
        default: 'descriptiveStatistic',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['descriptiveStatistic'],
          },
        },
        options: [
          {
            name: 'Percentile',
            value: 'percentile',
            description: 'Calculate a percentile for a numeric column',
            action: 'Calculate percentile',
          },
          {
            name: 'Summary Statistics',
            value: 'summary_statistics',
            description: 'Calculate count, sum, mean, median, min, max, variance, and standard deviation',
            action: 'Calculate summary statistics',
          },
          {
            name: 'Z Score',
            value: 'z_score',
            description: 'Calculate per-row z-scores for a numeric column',
            action: 'Calculate z scores',
          },
        ],
        default: 'summary_statistics',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['financeMath'],
          },
        },
        options: [
          {
            name: 'CAGR',
            value: 'cagr',
            description: 'Calculate compound annual growth rate from configured start/end columns',
            action: 'Calculate CAGR',
          },
          {
            name: 'Growth Rate',
            value: 'growth_rate',
            description: 'Calculate percentage growth between first/last values or two columns',
            action: 'Calculate growth rate',
          },
        ],
        default: 'growth_rate',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['group_aggregate'],
          },
        },
        options: [
          {
            name: 'Group Aggregate',
            value: 'group_aggregate',
            description: 'Aggregate numeric values by a configured group column',
            action: 'Aggregate groups',
          },
        ],
        default: 'group_aggregate',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['outlierAnalysis'],
          },
        },
        options: [
          {
            name: 'Outliers IQR',
            value: 'outliers_iqr',
            description: 'Detect outliers in a numeric column using IQR fences',
            action: 'Detect IQR outliers',
          },
        ],
        default: 'outliers_iqr',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['relationship'],
          },
        },
        options: [
          {
            name: 'Correlation',
            value: 'correlation',
            description: 'Calculate Pearson correlation between two numeric columns',
            action: 'Calculate correlation',
          },
        ],
        default: 'correlation',
      },
      {
        displayName: 'Aggregations',
        name: 'aggregations',
        type: 'multiOptions',
        options: [
          {
            name: 'Count',
            value: 'count',
          },
          {
            name: 'Max',
            value: 'max',
          },
          {
            name: 'Mean',
            value: 'mean',
          },
          {
            name: 'Min',
            value: 'min',
          },
          {
            name: 'Sum',
            value: 'sum',
          },
        ],
        default: ['count', 'sum', 'mean'],
        displayOptions: {
          show: {
            operation: ['group_aggregate'],
            resource: ['group_aggregate'],
          },
        },
        description: 'Aggregations to calculate for each group. Value Column is required unless only Count is selected.',
      },
      {
        displayName: 'CAGR End Value Column',
        name: 'cagrEndValueColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['cagr'],
            resource: ['financeMath'],
          },
        },
        description: 'Column with final values for CAGR',
      },
      {
        displayName: 'CAGR Periods',
        name: 'cagrPeriods',
        type: 'number',
        typeOptions: {
          minValue: 0,
        },
        default: 1,
        displayOptions: {
          show: {
            operation: ['cagr'],
            resource: ['financeMath'],
          },
        },
        description: 'Number of periods used in the CAGR formula',
      },
      {
        displayName: 'CAGR Start Value Column',
        name: 'cagrStartValueColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['cagr'],
            resource: ['financeMath'],
          },
        },
        description: 'Column with initial values for CAGR',
      },
      {
        displayName: 'Correlation X Column',
        name: 'correlationXColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['correlation'],
            resource: ['relationship'],
          },
        },
        description: 'First numeric column for Pearson correlation',
      },
      {
        displayName: 'Correlation Y Column',
        name: 'correlationYColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['correlation'],
            resource: ['relationship'],
          },
        },
        description: 'Second numeric column for Pearson correlation',
      },
      {
        displayName: 'Group Column',
        name: 'groupColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['group_aggregate'],
            resource: ['group_aggregate'],
          },
        },
        description: 'Column used to group rows before aggregation',
      },
      {
        displayName: 'Growth End Column',
        name: 'growthEndColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            growthMode: ['columns'],
            operation: ['growth_rate'],
            resource: ['financeMath'],
          },
        },
        description: 'End-value column for row-level growth calculations',
      },
      {
        displayName: 'Growth Mode',
        name: 'growthMode',
        type: 'options',
        options: [
          {
            name: 'Between First and Last Value',
            value: 'first_last',
          },
          {
            name: 'Between Start/End Columns',
            value: 'columns',
          },
        ],
        default: 'first_last',
        displayOptions: {
          show: {
            operation: ['growth_rate'],
            resource: ['financeMath'],
          },
        },
        description: 'Whether to calculate growth from one column over row order or from two configured columns',
      },
      {
        displayName: 'Growth Start Column',
        name: 'growthStartColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            growthMode: ['columns'],
            operation: ['growth_rate'],
            resource: ['financeMath'],
          },
        },
        description: 'Start-value column for row-level growth calculations',
      },
      {
        displayName: 'Growth Value Column',
        name: 'growthValueColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            growthMode: ['first_last'],
            operation: ['growth_rate'],
            resource: ['financeMath'],
          },
        },
        description: 'Numeric column used to calculate growth between first and last valid values',
      },
      {
        displayName: 'Percentile',
        name: 'percentile',
        type: 'number',
        typeOptions: {
          maxValue: 100,
          minValue: 0,
        },
        default: 50,
        displayOptions: {
          show: {
            operation: ['percentile'],
            resource: ['descriptiveStatistic'],
          },
        },
        description: 'Percentile to calculate, between 0 and 100',
      },
      {
        displayName: 'Result Column',
        name: 'resultColumn',
        type: 'string',
        default: 'zScore',
        displayOptions: {
          show: {
            operation: ['z_score'],
            resource: ['descriptiveStatistic'],
          },
        },
        description: 'Column name added to output rows with the calculated z-score',
      },
      {
        displayName: 'Value Column',
        name: 'valueColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: [
              'summary_statistics',
              'percentile',
              'z_score',
              'outliers_iqr',
              'group_aggregate',
            ],
            resource: ['descriptiveStatistic', 'group_aggregate', 'outlierAnalysis'],
          },
        },
        description: 'Numeric column used by the selected operation',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));

    try {
      const operation = this.getNodeParameter('operation', 0) as MathStatisticsOperation;
      const options = buildOptions(this, operation);
      const rows = items.map((item) => item.json);
      const result = calculateStatistics(rows, options);

      return [[{ json: result as unknown as IDataObject, pairedItem }]];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.continueOnFail()) {
        throw new NodeOperationError(this.getNode(), message);
      }

      const failureEnvelope = createFailureOutput({
        operation: 'summary_statistics',
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
            message: 'Math & Statistics execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}

function buildOptions(
  executeFunctions: IExecuteFunctions,
  operation: MathStatisticsOperation,
): CalculateStatisticsOptions {
  const options: CalculateStatisticsOptions = {
    operation,
  };

  switch (operation) {
    case 'cagr':
      options.valueColumn = executeFunctions.getNodeParameter('cagrStartValueColumn', 0, '') as string;
      options.secondaryValueColumn = executeFunctions.getNodeParameter('cagrEndValueColumn', 0, '') as string;
      options.cagrPeriods = executeFunctions.getNodeParameter('cagrPeriods', 0, 1) as number;
      break;
    case 'correlation':
      options.valueColumn = executeFunctions.getNodeParameter('correlationXColumn', 0, '') as string;
      options.secondaryValueColumn = executeFunctions.getNodeParameter('correlationYColumn', 0, '') as string;
      break;
    case 'group_aggregate':
      options.aggregations = executeFunctions.getNodeParameter(
        'aggregations',
        0,
        ['count', 'sum', 'mean'],
      ) as GroupAggregation[];
      options.groupColumn = executeFunctions.getNodeParameter('groupColumn', 0, '') as string;
      options.valueColumn = executeFunctions.getNodeParameter('valueColumn', 0, '') as string;
      break;
    case 'growth_rate':
      options.growthMode = executeFunctions.getNodeParameter(
        'growthMode',
        0,
        'first_last',
      ) as GrowthRateMode;

      if (options.growthMode === 'columns') {
        options.valueColumn = executeFunctions.getNodeParameter('growthStartColumn', 0, '') as string;
        options.secondaryValueColumn = executeFunctions.getNodeParameter('growthEndColumn', 0, '') as string;
      } else {
        options.valueColumn = executeFunctions.getNodeParameter('growthValueColumn', 0, '') as string;
      }
      break;
    case 'percentile':
      options.percentile = executeFunctions.getNodeParameter('percentile', 0, 50) as number;
      options.valueColumn = executeFunctions.getNodeParameter('valueColumn', 0, '') as string;
      break;
    case 'z_score':
      options.resultColumn = executeFunctions.getNodeParameter('resultColumn', 0, 'zScore') as string;
      options.valueColumn = executeFunctions.getNodeParameter('valueColumn', 0, '') as string;
      break;
    case 'outliers_iqr':
    case 'summary_statistics':
      options.valueColumn = executeFunctions.getNodeParameter('valueColumn', 0, '') as string;
      break;
  }

  return options;
}

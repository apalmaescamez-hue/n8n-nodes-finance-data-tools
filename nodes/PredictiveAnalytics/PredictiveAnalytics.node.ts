import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { runPredictiveAnalytics } from '../../domain/ml/forecasting';
import type {
  PredictiveAnalyticsOperation,
  PredictiveAnalyticsOptions,
} from '../../domain/ml/forecasting';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class PredictiveAnalytics implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Predictive Analytics',
    name: 'predictiveAnalytics',
    icon: 'file:predictiveAnalytics.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Run explainable forecasting operations on finance time series without arbitrary formulas.',
    defaults: {
      name: 'Predictive Analytics',
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'CAGR Forecast',
            value: 'cagr_forecast',
            description: 'Forecast using compound annual growth rate from the first and last valid values',
            action: 'Calculate CAGR forecast',
          },
          {
            name: 'Moving Average Forecast',
            value: 'moving_average_forecast',
            description: 'Forecast future points from a rolling moving average',
            action: 'Calculate moving average forecast',
          },
          {
            name: 'Simple Linear Regression',
            value: 'simple_linear_regression',
            description: 'Fit a simple linear regression and forecast future x steps',
            action: 'Calculate simple linear regression forecast',
          },
          {
            name: 'Trend Forecast',
            value: 'trend_forecast',
            description: 'Fit a linear trend over row order and forecast future points',
            action: 'Calculate trend forecast',
          },
        ],
        default: 'moving_average_forecast',
      },
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'string',
        default: '',
        description: 'Optional currency metadata included in the predictive result',
      },
      {
        displayName: 'Forecast Horizon',
        name: 'horizon',
        type: 'number',
        typeOptions: {
          minValue: 1,
        },
        default: 3,
        description: 'Number of future forecast points to generate',
      },
      {
        displayName: 'Max Recommended Horizon',
        name: 'maxHorizon',
        type: 'number',
        typeOptions: {
          minValue: 1,
        },
        default: 24,
        description: 'Recommended horizon threshold. Larger horizons are allowed but return warnings.',
      },
      {
        displayName: 'Periods Per Year',
        name: 'periodsPerYear',
        type: 'number',
        typeOptions: {
          minValue: 1,
        },
        default: 12,
        displayOptions: {
          show: {
            operation: ['cagr_forecast'],
          },
        },
        description: 'Number of observations that represent one year for CAGR conversion',
      },
      {
        displayName: 'Value Column',
        name: 'valueColumn',
        type: 'string',
        default: '',
        description: 'Column containing the numeric financial series to forecast',
      },
      {
        displayName: 'Window Size',
        name: 'windowSize',
        type: 'number',
        typeOptions: {
          minValue: 1,
        },
        default: 3,
        displayOptions: {
          show: {
            operation: ['moving_average_forecast'],
          },
        },
        description: 'Number of recent observations used for each moving average forecast step',
      },
      {
        displayName: 'X Column',
        name: 'xColumn',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['simple_linear_regression'],
          },
        },
        description: 'Numeric independent variable used by simple linear regression',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));
    let operation: PredictiveAnalyticsOperation = 'moving_average_forecast';

    try {
      operation = this.getNodeParameter('operation', 0) as PredictiveAnalyticsOperation;
      const rows = items.map((item) => item.json);
      const options: PredictiveAnalyticsOptions = {
        operation,
        currency: this.getNodeParameter('currency', 0, '') as string,
        horizon: this.getNodeParameter('horizon', 0, 3) as number,
        maxHorizon: this.getNodeParameter('maxHorizon', 0, 24) as number,
        periodsPerYear: this.getNodeParameter('periodsPerYear', 0, 12) as number,
        valueColumn: this.getNodeParameter('valueColumn', 0, '') as string,
        windowSize: this.getNodeParameter('windowSize', 0, 3) as number,
        xColumn: this.getNodeParameter('xColumn', 0, '') as string,
      };
      const result = runPredictiveAnalytics(rows, options);

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
            message: 'Predictive Analytics execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}


import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { runAiFinanceTool } from '../../domain/ai/financeTool';
import type { AiFinanceToolOperation, AiFinanceToolOptions } from '../../domain/ai/financeTool';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class AiFinanceTool implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'AI Finance Tool',
    name: 'aiFinanceTool',
    icon: 'file:aiFinanceTool.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Controlled allowlist facade for AI Agents to call finance/data/predictive tools safely.',
    defaults: {
      name: 'AI Finance Tool',
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
          { name: 'Accounting', value: 'accounting' },
          { name: 'Data', value: 'data' },
          { name: 'Finance', value: 'finance' },
          { name: 'Prediction', value: 'prediction' },
          { name: 'Report', value: 'report' },
        ],
        default: 'data',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['accounting'] } },
        options: [
          {
            name: 'Validate Accounting Entries',
            value: 'validate_accounting_entries',
            description: 'Validate accounting entries and optionally build a trial balance',
            action: 'Validate accounting entries',
          },
        ],
        default: 'validate_accounting_entries',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['data'] } },
        options: [
          {
            name: 'Clean Data',
            value: 'clean_data',
            description: 'Clean incoming tabular JSON rows',
            action: 'Clean data',
          },
          {
            name: 'Normalize Data',
            value: 'normalize_data',
            description: 'Normalize finance columns in incoming tabular JSON rows',
            action: 'Normalize data',
          },
          {
            name: 'Profile Data',
            value: 'profile_data',
            description: 'Profile incoming tabular JSON rows',
            action: 'Profile data',
          },
        ],
        default: 'profile_data',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['finance'] } },
        options: [
          {
            name: 'Calculate Financial Ratios',
            value: 'calculate_financial_ratios',
            description: 'Calculate allowlisted financial ratios from one aggregated object',
            action: 'Calculate financial ratios',
          },
          {
            name: 'Calculate Statistics',
            value: 'calculate_statistics',
            description: 'Calculate allowlisted math/statistics operations on tabular rows',
            action: 'Calculate statistics',
          },
        ],
        default: 'calculate_financial_ratios',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['prediction'] } },
        options: [
          {
            name: 'Evaluate Prediction Model',
            value: 'evaluate_prediction_model',
            description: 'Evaluate actual vs predicted columns with basic error metrics',
            action: 'Evaluate prediction model',
          },
          {
            name: 'Forecast Financial Metric',
            value: 'forecast_financial_metric',
            description: 'Run an allowlisted predictive forecast operation',
            action: 'Forecast financial metric',
          },
          {
            name: 'Train Simple Regression',
            value: 'train_simple_regression',
            description: 'Fit simple linear regression and return directional forecast output',
            action: 'Train simple regression',
          },
        ],
        default: 'forecast_financial_metric',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['report'] } },
        options: [
          {
            name: 'Build Financial Report',
            value: 'build_financial_report',
            description: 'Build deterministic financial report JSON',
            action: 'Build financial report',
          },
        ],
        default: 'build_financial_report',
      },
      {
        displayName: 'Actual Column',
        name: 'actualColumn',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['evaluate_prediction_model'], resource: ['prediction'] } },
        description: 'Column containing actual observed values for prediction evaluation',
      },
      {
        displayName: 'Advanced Domain Options JSON',
        name: 'advancedOptionsJson',
        type: 'json',
        default: '{}',
        description: 'Optional JSON object forwarded to the underlying domain operation. No formulas or code are evaluated.',
      },
      {
        displayName: 'Allow Predictive Operations',
        name: 'allowPredictiveOperations',
        type: 'boolean',
        default: false,
        displayOptions: { show: { resource: ['prediction'] } },
        description: 'Whether predictive operations are enabled. They are disabled by default and must be explicitly allowed.',
      },
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'string',
        default: '',
        description: 'Optional currency metadata forwarded to finance/report/prediction operations',
      },
      {
        displayName: 'Forecast Horizon',
        name: 'forecastHorizon',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 3,
        displayOptions: { show: { resource: ['prediction'] } },
        description: 'Number of future points requested for predictive operations',
      },
      {
        displayName: 'Max Forecast Horizon',
        name: 'maxForecastHorizon',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 12,
        displayOptions: { show: { resource: ['prediction'] } },
        description: 'Hard maximum forecast horizon allowed by this AI facade',
      },
      {
        displayName: 'Max Rows',
        name: 'maxRows',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 1000,
        description: 'Hard maximum number of input rows accepted by this AI facade',
      },
      {
        displayName: 'Predicted Column',
        name: 'predictedColumn',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['evaluate_prediction_model'], resource: ['prediction'] } },
        description: 'Column containing predicted values for prediction evaluation',
      },
      {
        displayName: 'Value Column',
        name: 'valueColumn',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['finance', 'prediction'] } },
        description: 'Primary numeric value column for statistics or predictive operations',
      },
      {
        displayName: 'X Column',
        name: 'xColumn',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['train_simple_regression'], resource: ['prediction'] } },
        description: 'Independent numeric variable for simple regression',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));
    let operation: AiFinanceToolOperation = 'profile_data';

    try {
      operation = this.getNodeParameter('operation', 0) as AiFinanceToolOperation;
      const input = items.length === 1 ? items[0].json : items.map((item) => item.json);
      const result = runAiFinanceTool(input, buildOptions(this, operation));

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
        errors: [createNodeError({ code: 'EXECUTION_ERROR', severity: 'error', message })],
        auditTrail: [
          createAuditTrailEvent({
            step: 'execution_failed',
            message: 'AI Finance Tool execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}
function buildOptions(
  executeFunctions: IExecuteFunctions,
  operation: AiFinanceToolOperation,
): AiFinanceToolOptions {
  const domainOptions = parseDomainOptions(executeFunctions, 'advancedOptionsJson');

  return {
    operation,
    actualColumn: executeFunctions.getNodeParameter('actualColumn', 0, '') as string,
    allowPredictiveOperations: executeFunctions.getNodeParameter('allowPredictiveOperations', 0, false) as boolean,
    currency: executeFunctions.getNodeParameter('currency', 0, '') as string,
    domainOptions,
    forecastHorizon: executeFunctions.getNodeParameter('forecastHorizon', 0, 3) as number,
    maxForecastHorizon: executeFunctions.getNodeParameter('maxForecastHorizon', 0, 12) as number,
    maxRows: executeFunctions.getNodeParameter('maxRows', 0, 1000) as number,
    predictedColumn: executeFunctions.getNodeParameter('predictedColumn', 0, '') as string,
    valueColumn: executeFunctions.getNodeParameter('valueColumn', 0, '') as string,
    xColumn: executeFunctions.getNodeParameter('xColumn', 0, '') as string,
  };
}

function parseDomainOptions(
  executeFunctions: IExecuteFunctions,
  parameterName: string,
): Record<string, unknown> {
  const rawValue = executeFunctions.getNodeParameter(parameterName, 0, '{}') as string | object;

  if (typeof rawValue !== 'string') {
    return isPlainObject(rawValue) ? rawValue as Record<string, unknown> : {};
  }

  const trimmed = rawValue.trim();

  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!isPlainObject(parsed)) {
      throw new NodeOperationError(
        executeFunctions.getNode(),
        'Advanced Domain Options JSON must be a JSON object.',
      );
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error && error.message.includes('must be a JSON object')
      ? error.message
      : 'Advanced Domain Options JSON is not valid JSON.';

    throw new NodeOperationError(executeFunctions.getNode(), message);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

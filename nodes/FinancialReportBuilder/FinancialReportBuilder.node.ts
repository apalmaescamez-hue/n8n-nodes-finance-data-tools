import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildFinancialReport } from '../../domain/finance/reports';
import type {
  BuildFinancialReportOptions,
  FinancialReportOperation,
  FinancialReportType,
} from '../../domain/finance/reports';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class FinancialReportBuilder implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Financial Report Builder',
    name: 'financialReportBuilder',
    icon: 'file:financialReportBuilder.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["reportType"]}}',
    description: 'Build deterministic financial report JSON from aggregated finance sections.',
    defaults: {
      name: 'Financial Report Builder',
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
            name: 'Build Financial Report',
            value: 'build_financial_report',
            description: 'Build a deterministic financial report from aggregated JSON sections',
            action: 'Build financial report',
          },
        ],
        default: 'build_financial_report',
      },
      {
        displayName: 'Report Type',
        name: 'reportType',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'AI Agent Report',
            value: 'ai_agent_report',
            description: 'Return report sections with agent instructions and limitations',
          },
          {
            name: 'Balance Sheet',
            value: 'balance_sheet',
            description: 'Build a balance sheet section and balance equation check',
          },
          {
            name: 'Cash Summary',
            value: 'cash_summary',
            description: 'Build opening cash, inflows, outflows, net cash flow, and closing cash summary',
          },
          {
            name: 'Dashboard JSON',
            value: 'dashboard_json',
            description: 'Return report sections plus dashboard-ready cards and tables',
          },
          {
            name: 'Executive Summary',
            value: 'executive_summary',
            description: 'Build a compact executive summary from available financial sections',
          },
          {
            name: 'KPI Table',
            value: 'kpi_table',
            description: 'Build a KPI table from kpis and ratios sections',
          },
          {
            name: 'Profit and Loss',
            value: 'profit_and_loss',
            description: 'Build revenue, gross profit, operating income, margins, and net income rows',
          },
        ],
        default: 'executive_summary',
      },
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'string',
        default: 'EUR',
        description: 'Currency code used in report metadata and currency metrics when input does not override it',
      },
      {
        displayName: 'Include Dashboard Data',
        name: 'includeDashboardData',
        type: 'boolean',
        default: false,
        description: 'Whether to include dashboard-ready cards and tables for non-dashboard report types',
      },
      {
        displayName: 'Include Source Data',
        name: 'includeSourceData',
        type: 'boolean',
        default: false,
        description: 'Whether to copy sanitized source data into the output for traceability',
      },
      {
        displayName: 'Reporting Period Label',
        name: 'reportingPeriodLabel',
        type: 'string',
        default: '',
        description: 'Optional label shown in report title and executive summary',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));
    let operation: FinancialReportOperation = 'build_financial_report';

    try {
      operation = this.getNodeParameter('operation', 0) as FinancialReportOperation;
      const input = items.length === 1 ? items[0].json : items.map((item) => item.json);
      const options: BuildFinancialReportOptions = {
        operation,
        currency: this.getNodeParameter('currency', 0, 'EUR') as string,
        includeDashboardData: this.getNodeParameter('includeDashboardData', 0, false) as boolean,
        includeSourceData: this.getNodeParameter('includeSourceData', 0, false) as boolean,
        reportType: this.getNodeParameter('reportType', 0, 'executive_summary') as FinancialReportType,
        reportingPeriodLabel: this.getNodeParameter('reportingPeriodLabel', 0, '') as string,
      };
      const result = buildFinancialReport(input, options);

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
            message: 'Financial Report Builder execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}


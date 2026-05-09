import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { validateJournalEntries } from '../../domain/accounting';
import type { AccountingOperation, AccountingValidationOptions } from '../../domain/accounting';
import { createAuditTrailEvent, createFailureOutput, createNodeError } from '../../shared';

export class AccountingValidator implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Accounting Validator',
    name: 'accountingValidator',
    icon: 'file:accountingValidator.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Validate journal entries and generate a minimal trial balance with double-entry checks.',
    defaults: {
      name: 'Accounting Validator',
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
            name: 'Build Trial Balance',
            value: 'build_trial_balance',
            description: 'Validate entries and generate a trial balance when no blocking errors exist',
            action: 'Build trial balance',
          },
          {
            name: 'Validate and Build Trial Balance',
            value: 'validate_and_build_trial_balance',
            description: 'Validate journal entries and include trial balance output when valid',
            action: 'Validate and build trial balance',
          },
          {
            name: 'Validate Journal Entries',
            value: 'validate_journal_entries',
            description: 'Validate journal entries without generating a trial balance unless requested',
            action: 'Validate journal entries',
          },
        ],
        default: 'validate_journal_entries',
      },
      {
        displayName: 'Allow Line With Both Debit And Credit',
        name: 'allowLineWithBothDebitAndCredit',
        type: 'boolean',
        default: false,
        description: 'Whether a single journal line may contain non-zero debit and credit amounts simultaneously',
      },
      {
        displayName: 'Allow Negative Amounts',
        name: 'allowNegativeAmounts',
        type: 'boolean',
        default: false,
        description: 'Whether negative debit or credit amounts are accepted as warnings instead of blocking errors',
      },
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'string',
        default: 'EUR',
        description: 'Default journal currency used when an entry does not provide one',
      },
      {
        displayName: 'Expected Period End',
        name: 'expectedPeriodEnd',
        type: 'string',
        default: '',
        description: 'Optional expected period end date in YYYY-MM-DD format. Entries after it emit warnings.',
      },
      {
        displayName: 'Expected Period Start',
        name: 'expectedPeriodStart',
        type: 'string',
        default: '',
        description: 'Optional expected period start date in YYYY-MM-DD format. Entries before it emit warnings.',
      },
      {
        displayName: 'Include Trial Balance',
        name: 'includeTrialBalance',
        type: 'boolean',
        default: false,
        description: 'Whether validation-only operation should also include a trial balance when no errors exist',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const pairedItem = items.map((_item, index) => ({ item: index }));
    let operation: AccountingOperation = 'validate_journal_entries';

    try {
      operation = this.getNodeParameter('operation', 0) as AccountingOperation;
      const input = items.length === 1 ? items[0].json : items.map((item) => item.json);
      const options: AccountingValidationOptions = {
        operation,
        allowLineWithBothDebitAndCredit: this.getNodeParameter(
          'allowLineWithBothDebitAndCredit',
          0,
          false,
        ) as boolean,
        allowNegativeAmounts: this.getNodeParameter('allowNegativeAmounts', 0, false) as boolean,
        currency: this.getNodeParameter('currency', 0, 'EUR') as string,
        expectedPeriodEnd: this.getNodeParameter('expectedPeriodEnd', 0, '') as string,
        expectedPeriodStart: this.getNodeParameter('expectedPeriodStart', 0, '') as string,
        includeTrialBalance: this.getNodeParameter('includeTrialBalance', 0, false) as boolean,
      };
      const result = validateJournalEntries(input, options);

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
            message: 'Accounting Validator execution failed, but continueOnFail is enabled.',
          }),
        ],
      });

      return [[{ json: failureEnvelope as IDataObject, pairedItem }]];
    }
  }
}


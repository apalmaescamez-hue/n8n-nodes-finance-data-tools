import { describe, expect, it } from 'vitest';

import {
  createAuditTrailEvent,
  createFailureOutput,
  createNodeError,
  createSuccessOutput,
} from '../shared';

describe('shared standard output helpers', () => {
  it('creates a successful standard output envelope with explicit metadata', () => {
    const output = createSuccessOutput({
      operation: 'testOperation',
      data: { value: 1 },
      metadata: {
        generatedAt: '2026-05-08T00:00:00.000Z',
        durationMs: 7,
        rowCount: 2,
        columnCount: 3,
      },
      auditTrail: [
        createAuditTrailEvent({
          timestamp: '2026-05-08T00:00:00.000Z',
          step: 'completed',
          message: 'Completed.',
        }),
      ],
    });

    expect(output).toEqual({
      success: true,
      operation: 'testOperation',
      data: { value: 1 },
      metadata: {
        generatedAt: '2026-05-08T00:00:00.000Z',
        durationMs: 7,
        rowCount: 2,
        columnCount: 3,
      },
      warnings: [],
      errors: [],
      auditTrail: [
        {
          timestamp: '2026-05-08T00:00:00.000Z',
          step: 'completed',
          message: 'Completed.',
        },
      ],
    });
  });

  it('creates a failure output envelope with normalized node errors', () => {
    const output = createFailureOutput({
      operation: 'testOperation',
      metadata: {
        generatedAt: '2026-05-08T00:00:00.000Z',
        durationMs: 0,
        rowCount: 0,
        columnCount: 0,
      },
      errors: [
        createNodeError({
          code: 'TEST_ERROR',
          severity: 'error',
          message: 'A test error occurred.',
        }),
      ],
    });

    expect(output.success).toBe(false);
    expect(output.data).toBeNull();
    expect(output.errors).toEqual([
      {
        code: 'TEST_ERROR',
        severity: 'error',
        message: 'A test error occurred.',
      },
    ]);
  });
});

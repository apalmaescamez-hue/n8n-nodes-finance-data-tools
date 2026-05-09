import type { AuditTrailEvent } from '../output';

export interface CreateAuditTrailEventInput {
  step: string;
  message: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

export function createAuditTrailEvent(input: CreateAuditTrailEventInput): AuditTrailEvent {
  const event: AuditTrailEvent = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    step: input.step,
    message: input.message,
  };

  if (input.details !== undefined) {
    event.details = input.details;
  }

  return event;
}

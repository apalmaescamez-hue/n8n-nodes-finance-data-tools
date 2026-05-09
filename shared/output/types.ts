export type NodeSeverity = 'info' | 'warning' | 'error';

export type NodeWarningSeverity = Exclude<NodeSeverity, 'error'>;

export interface NodeMessageBase {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface NodeWarning extends NodeMessageBase {
  severity: NodeWarningSeverity;
}

export interface NodeError extends NodeMessageBase {
  severity: 'error';
}

export interface AuditTrailEvent {
  timestamp: string;
  step: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface StandardNodeMetadata {
  generatedAt: string;
  durationMs: number;
  rowCount: number;
  columnCount: number;
}

export interface StandardNodeOutput<
  TData,
  TMetadata extends StandardNodeMetadata = StandardNodeMetadata,
> {
  success: boolean;
  operation: string;
  data: TData | null;
  metadata: TMetadata;
  warnings: NodeWarning[];
  errors: NodeError[];
  auditTrail: AuditTrailEvent[];
}

import type {
  AuditTrailEvent,
  NodeError,
  NodeWarning,
  StandardNodeMetadata,
  StandardNodeOutput,
} from './types';

export interface StandardNodeMetadataInput {
  generatedAt?: string;
  durationMs?: number;
  startedAt?: number;
  rowCount: number;
  columnCount: number;
}

export interface CreateStandardNodeOutputParams<
  TData,
  TMetadata extends StandardNodeMetadata = StandardNodeMetadata,
> {
  success: boolean;
  operation: string;
  data: TData | null;
  metadata: StandardNodeMetadataInput | TMetadata;
  warnings?: NodeWarning[];
  errors?: NodeError[];
  auditTrail?: AuditTrailEvent[];
}

type CreateFinalStateOutputParams<TData> = Omit<
  CreateStandardNodeOutputParams<TData>,
  'data' | 'success'
>;

export function createStandardMetadata(input: StandardNodeMetadataInput): StandardNodeMetadata {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    durationMs: input.durationMs ?? (input.startedAt === undefined ? 0 : Date.now() - input.startedAt),
    rowCount: input.rowCount,
    columnCount: input.columnCount,
  };
}

export function createStandardNodeOutput<
  TData,
  TMetadata extends StandardNodeMetadata = StandardNodeMetadata,
>(
  params: CreateStandardNodeOutputParams<TData, TMetadata>,
): StandardNodeOutput<TData, TMetadata> {
  return {
    success: params.success,
    operation: params.operation,
    data: params.data,
    metadata: createStandardMetadata(params.metadata) as TMetadata,
    warnings: params.warnings ?? [],
    errors: params.errors ?? [],
    auditTrail: params.auditTrail ?? [],
  };
}

export function createSuccessOutput<TData>(
  params: CreateFinalStateOutputParams<TData> & { data: TData },
): StandardNodeOutput<TData> {
  return createStandardNodeOutput({
    ...params,
    success: true,
    data: params.data,
  });
}

export function createFailureOutput<TData = unknown>(
  params: CreateFinalStateOutputParams<TData> & { data?: TData | null },
): StandardNodeOutput<TData> {
  return createStandardNodeOutput({
    ...params,
    success: false,
    data: params.data ?? null,
  });
}

import type { NodeError, NodeWarning } from '../output';

export function createNodeError(error: NodeError): NodeError {
  return error;
}

export function createNodeWarning(warning: NodeWarning): NodeWarning {
  return warning;
}

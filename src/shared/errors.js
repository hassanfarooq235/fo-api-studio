/** Small error helper that carries a "kind" so the UI can render useful guidance. */

export class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

export function err(kind, message) {
  return new ApiError(kind, message);
}

/** Serialize any thrown value into a response error payload. */
export function toErrorPayload(e) {
  return {
    kind: e?.kind || 'internal',
    message: String(e?.message || e),
  };
}

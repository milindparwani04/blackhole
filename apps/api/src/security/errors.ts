import type { ApiErrorCode } from '../../../../packages/shared/src/index.js';

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SOURCE_UNAVAILABLE: 502,
  RATE_LIMITED: 429,
  PERMISSION_REQUIRED: 403,
  FORBIDDEN_ORIGIN: 403,
};

export class AppError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

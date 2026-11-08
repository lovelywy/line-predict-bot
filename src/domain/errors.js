export class BusinessError extends Error {
  constructor(code, userMessage, options = {}) {
    super(userMessage, options);
    this.name = 'BusinessError';
    this.code = code;
    this.userMessage = userMessage;
    this.details = options.details ?? null;
  }
}

export function isBusinessError(error) {
  return error instanceof BusinessError;
}

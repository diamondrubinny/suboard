export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'BAD_REQUEST', message, fields);
export const unauthorized = (message = 'נדרשת התחברות') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'אין לך הרשאה לבצע פעולה זו') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'המשאב לא נמצא') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

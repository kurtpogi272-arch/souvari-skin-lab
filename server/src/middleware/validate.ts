import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[source]);
      req[source] = data;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        // Surface the field-level detail in the top-level message so a client
        // that only shows `message` (the customer/admin forms) can tell the
        // user what to fix instead of a bare "Validation failed".
        const first = errors[0];
        const message = first
          ? first.field
            ? `${first.field}: ${first.message}`
            : first.message
          : 'Validation failed';
        res.status(400).json({
          success: false,
          message,
          errors,
        });
        return;
      }
      next(error);
    }
  };
}

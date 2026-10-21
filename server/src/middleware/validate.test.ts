import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from './validate';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  it('passes through valid input and replaces req.body with parsed data', () => {
    const schema = z.object({ name: z.string().min(1) });
    const req: any = { body: { name: 'Ana', extra: 'dropped' } };
    const next = vi.fn();

    validate(schema)(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'Ana' });
  });

  it('returns 400 with the field name in the top-level message', () => {
    const schema = z.object({ gender: z.enum(['male', 'female']) });
    const req: any = { body: { gender: 'unicorn' } };
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toContain('gender');
    expect(body.errors[0].field).toBe('gender');
  });
});

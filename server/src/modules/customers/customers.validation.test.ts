import { describe, it, expect } from 'vitest';
import { updateCustomerSchema } from './customers.validation';

describe('updateCustomerSchema.gender', () => {
  it('accepts a recorded gender', () => {
    const parsed = updateCustomerSchema.parse({ gender: 'female' });
    expect(parsed.gender).toBe('female');
  });

  it('accepts an empty string (unselected <select>) instead of failing validation', () => {
    const parsed = updateCustomerSchema.parse({ gender: '' });
    expect(parsed.gender).toBe('');
  });

  it('accepts null (gender never recorded)', () => {
    const parsed = updateCustomerSchema.parse({ gender: null });
    expect(parsed.gender).toBeNull();
  });

  it('still rejects an unknown gender value', () => {
    const result = updateCustomerSchema.safeParse({ gender: 'unicorn' });
    expect(result.success).toBe(false);
  });

  it('accepts a partial update that omits gender entirely', () => {
    const parsed = updateCustomerSchema.parse({ first_name: 'Ana' });
    expect(parsed.gender).toBeUndefined();
    expect(parsed.first_name).toBe('Ana');
  });
});

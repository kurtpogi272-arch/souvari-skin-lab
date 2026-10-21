import { z } from 'zod';

export const createCustomerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().max(20).optional(),
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  date_of_birth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  address: z.string().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  notes: z.string().optional(),
  avatar_url: z.string().max(500).optional(),
});

export const updateCustomerSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(128).optional(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  date_of_birth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullable().or(z.literal('')).optional(),
  address: z.string().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  notes: z.string().optional(),
  avatar_url: z.string().max(500).optional(),
});

/**
 * Update schema mirrors create, but every field is optional and "no gender"
 * arrives from the UI as either an empty string (unselected `<select>`) or
 * null (a customer whose gender was never recorded). Both are normalized to
 * null by the service, so the enum accepts them here too instead of returning
 * a bare "Validation failed".
 */
export const walkInCustomerSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().max(20).optional(),
  email: z.string().email('Invalid email address').optional(),
  notes: z.string().optional(),
});

export const customerQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  sort_by: z.enum(['first_name', 'last_name', 'created_at']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type WalkInCustomerInput = z.infer<typeof walkInCustomerSchema>;
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

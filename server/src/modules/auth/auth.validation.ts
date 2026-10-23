import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().max(20).optional(),
  date_of_birth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const recoveryEmail = z.string().trim().toLowerCase().email('Invalid email address').max(255);

export const forgotPasswordSchema = z.object({ email: recoveryEmail });

export const verifyResetCodeSchema = z.object({
  email: recoveryEmail,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid reset token'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match', path: ['confirmPassword'],
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  BACKEND_URL: z.string().default('http://localhost:3000'),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().default('gpt-3.5-turbo'),
  AI_BASE_URL: z.string().optional().default(''),
  SMS_PROVIDER: z.string().default('mock'),
  SMS_API_KEY: z.string().optional().default(''),
  SMS_SENDER: z.string().default('SOUVARI'),
  TEXTBEE_DEVICE_ID: z.string().optional().default(''),
  REMINDERS_ENABLED: z.coerce.boolean().default(true),
  REMINDER_RUN_HOUR: z.coerce.number().default(8),
  MAIL_HOST: z.string().default('smtp.gmail.com'),
  MAIL_PORT: z.coerce.number().default(587),
  MAIL_USER: z.string().default(''),
  MAIL_PASS: z.string().default(''),
  MAIL_FROM_NAME: z.string().default('Souvari Skin Lab'),
  MAIL_PROVIDER: z.enum(['auto', 'smtp', 'resend']).default('auto'),
  MAIL_FROM_EMAIL: z.string().trim().default(''),
  RESEND_API_KEY: z.string().trim().default(''),
  REVIEW_URL: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

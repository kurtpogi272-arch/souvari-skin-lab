export interface ISMSProvider {
  send(to: string, message: string): Promise<{ success: boolean; externalId?: string; error?: string }>;
}

export interface SMSLogData {
  userId?: number;
  recipientPhone: string;
  message: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  externalId?: string;
  errorMessage?: string;
}

import { env } from '../config/env';
import logger from '../utils/logger';

let cachedProvider: ISMSProvider | null = null;

export function getSMSProvider(): ISMSProvider {
  if (cachedProvider) return cachedProvider;

  if (env.SMS_PROVIDER === 'semaphore' && env.SMS_API_KEY) {
    const { SemaphoreSMSProvider } = require('./semaphore-sms.provider');
    cachedProvider = new SemaphoreSMSProvider();
  } else if (env.SMS_PROVIDER === 'textbee' && env.SMS_API_KEY && env.TEXTBEE_DEVICE_ID) {
    const { TextBeeSMSProvider } = require('./textbee-sms.provider');
    cachedProvider = new TextBeeSMSProvider();
  } else {
    // No usable provider configured: fall back to the mock, which reports
    // success without delivering anything. Log loudly so "SMS sent" is never
    // mistaken for a real delivery when credentials are missing or wrong.
    logger.warn(
      `[SMS] Provider "${env.SMS_PROVIDER}" is not fully configured; using MOCK provider — messages will NOT be delivered.`
    );
    const { MockSMSProvider } = require('./mock-sms.provider');
    cachedProvider = new MockSMSProvider();
  }

  return cachedProvider!;
}
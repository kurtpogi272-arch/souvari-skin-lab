export interface SMSDeliveryStatus {
  /** Provider-normalized state for a single message. */
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  /** When the provider recorded the carrier confirming delivery, if any. */
  deliveredAt?: Date | null;
  /** Human-readable failure reason when the provider reports one. */
  error?: string | null;
}

export interface ISMSProvider {
  send(to: string, message: string): Promise<{ success: boolean; externalId?: string; error?: string }>;
  /**
   * Follow up on a previously accepted send, when the provider supports it.
   *
   * Optional: providers without a status API simply omit it and the poller
   * skips their log rows. `externalId` is exactly what `send()` returned.
   */
  getStatus?(externalId: string): Promise<SMSDeliveryStatus | null>;
  canTrack?(externalId: string): boolean;
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

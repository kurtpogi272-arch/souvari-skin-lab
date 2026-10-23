import { ISMSProvider, SMSDeliveryStatus } from './sms.service';
import { env } from '../config/env';
import logger from '../utils/logger';
import { toPHNumber } from '../utils/phone';

export class SemaphoreSMSProvider implements ISMSProvider {
  canTrack(externalId: string): boolean {
    return /^semaphore:\d+$/.test(externalId);
  }

  private apiKey: string;
  private senderName: string;

  constructor() {
    this.apiKey = env.SMS_API_KEY;
    this.senderName = env.SMS_SENDER;
  }

  async send(to: string, message: string): Promise<{ success: boolean; externalId?: string; error?: string }> {
    const recipient = toPHNumber(to);
    if (!recipient) {
      const errorMsg = 'Invalid or non-Philippine recipient phone number';
      logger.error(`[SEMAPHORE SMS] ${errorMsg}: ${to}`);
      return { success: false, error: errorMsg };
    }

    try {
      const url = 'https://api.semaphore.co/api/v4/messages';

      const body = new URLSearchParams({
        apikey: this.apiKey,
        number: recipient,
        message,
      });

      if (this.senderName) {
        body.set('sendername', this.senderName);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(20000),
      });

      const result: any = await response.json().catch(() => null);
      const entry = Array.isArray(result) ? result[0] : null;
      const status = String(entry?.status ?? '').toLowerCase();

      if (!response.ok || !entry?.message_id || !['queued', 'pending', 'sent'].includes(status)) {
        const errorMsg = result?.message || result?.error ||
          (entry?.message_id ? `Semaphore message status: ${status || 'unknown'}` :
            entry?.message || (result && !Array.isArray(result) ? JSON.stringify(result) : `Invalid Semaphore response (HTTP ${response.status})`));
        logger.error(`[SEMAPHORE SMS] Failed to ${recipient}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const externalId = `semaphore:${entry.message_id}`;
      logger.info(`[SEMAPHORE SMS] Accepted for ${recipient}, id: ${externalId}`);
      return { success: true, externalId };
    } catch (err: any) {
      logger.error(`[SEMAPHORE SMS] Error sending to ${to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async getStatus(externalId: string): Promise<SMSDeliveryStatus | null> {
    if (!this.canTrack(externalId)) return null;
    const id = externalId.slice('semaphore:'.length);
    try {
      const url = new URL(`https://api.semaphore.co/api/v4/messages/${id}`);
      url.searchParams.set('apikey', this.apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) return null;
      const result: any = await response.json();
      const entry = Array.isArray(result) ? result[0] : result;
      if (String(entry?.message_id) !== id) return null;
      switch (String(entry.status).toLowerCase()) {
        case 'queued':
        case 'pending':
          return { status: 'queued' };
        // Semaphore documents Sent as delivered to the network, not the handset.
        case 'sent':
          return { status: 'sent' };
        case 'failed':
        case 'refunded':
          return { status: 'failed', error: `Semaphore message status: ${entry.status}` };
        default:
          return null;
      }
    } catch {
      // Do not log the request URL: it contains the account API key.
      logger.warn(`[SEMAPHORE SMS] Status lookup failed for message ${id}`);
      return null;
    }
  }
}

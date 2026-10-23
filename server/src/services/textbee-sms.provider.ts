import { ISMSProvider, SMSDeliveryStatus } from './sms.service';
import { env } from '../config/env';
import logger from '../utils/logger';

const TEXTBEE_BASE = 'https://api.textbee.dev/api/v1';

/**
 * Maps a TextBee message/batch state onto the app's SmsStatus vocabulary.
 *
 * TextBee tracks a send through pending -> dispatched -> sent -> delivered, with
 * failed/unknown as terminal outcomes. The app only has queued/sent/delivered/
 * failed, so the intermediate queued states collapse to "queued" and "unknown"
 * is treated as not-yet-delivered (keep waiting) rather than a hard failure.
 */
function mapTextBeeStatus(status: string | undefined | null): SMSDeliveryStatus['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'delivered':
      return 'delivered';
    case 'sent':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'pending':
    case 'dispatched':
      return 'queued';
    default:
      // unknown / missing: the phone has not reported an outcome yet.
      return 'queued';
  }
}

export class TextBeeSMSProvider implements ISMSProvider {
  canTrack(externalId: string): boolean {
    return /^[a-f0-9]{24}:[a-f0-9]{24}$/i.test(externalId);
  }

  private apiKey: string;
  private deviceId: string;

  constructor() {
    this.apiKey = env.SMS_API_KEY;
    this.deviceId = env.TEXTBEE_DEVICE_ID || '';
  }

  async send(to: string, message: string): Promise<{ success: boolean; externalId?: string; error?: string }> {
    try {
      // Account-level endpoint: the device is chosen by TEXTBEE_DEVICE_ID in the
      // body, and the response carries the smsBatchId used to track delivery.
      const url = `${TEXTBEE_BASE}/gateway/send-sms`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          recipients: [to],
          message,
          ...(this.deviceId ? { deviceId: this.deviceId } : {}),
        }),
      });

      const result: any = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg =
          result?.message || result?.error || (Array.isArray(result) && result[0]?.message) || `HTTP ${response.status}`;
        logger.error(`[TEXTBEE SMS] Failed to ${to}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const batchId: string | undefined = result?.data?.smsBatchId || result?.smsBatchId;
      // Store the batch id together with the device so the poller can ask for
      // this exact batch's status later without another lookup.
      const externalId = batchId ? `${this.deviceId}:${batchId}` : undefined;
      logger.info(`[TEXTBEE SMS] Queued to ${to}, batch: ${batchId ?? 'unknown'}`);
      return { success: true, externalId };
    } catch (err: any) {
      logger.error(`[TEXTBEE SMS] Error sending to ${to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Resolves the delivery state of a send by batch id.
   *
   * A batch has one message per recipient, so batch counts decide the outcome:
   * delivered once every message reports delivered, failed when every message
   * failed, and otherwise still queued/sent while the phone works through it.
   */
  async getStatus(externalId: string): Promise<SMSDeliveryStatus | null> {
    const [deviceId, batchId] = (externalId ?? '').split(':');
    if (!deviceId || !batchId) return null;

    try {
      const url = `${TEXTBEE_BASE}/gateway/devices/${deviceId}/sms-batch/${batchId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
      });

      const result: any = await response.json().catch(() => null);
      if (!response.ok || !result?.data?.batch) {
        // A 404 (e.g. an old/deleted device or batch) is not a delivery failure.
        return null;
      }

      const batch = result.data.batch;
      const messages: any[] = result.data.messages ?? [];
      const firstDelivered = messages.find((m) => m?.deliveredAt);
      const failedMessage = messages.find((m) => (m?.status ?? '').toLowerCase() === 'failed');

      const recipientCount = Number(batch.recipientCount) || messages.length || 1;
      const deliveredCount = Number(batch.deliveredCount) || 0;
      const failureCount = Number(batch.failureCount) || 0;

      if (deliveredCount >= recipientCount && recipientCount > 0) {
        return {
          status: 'delivered',
          deliveredAt: firstDelivered?.deliveredAt ? new Date(firstDelivered.deliveredAt) : new Date(),
        };
      }

      if (failureCount >= recipientCount && recipientCount > 0) {
        return { status: 'failed', error: failedMessage?.errorMessage || batch.error || 'Message failed at the device' };
      }

      // Some went, some did not: report the positive outcome and let the carrier
      // confirmation for the individual recipient stand in for "delivered".
      const successCount = Number(batch.successCount) || 0;
      const mapped = mapTextBeeStatus(batch.status);
      if (successCount > 0 && mapped === 'queued') {
        return { status: 'sent', error: failedMessage?.errorMessage || null };
      }
      return { status: mapped, error: failedMessage?.errorMessage || batch.error || null };
    } catch (err: any) {
      logger.warn(`[TEXTBEE SMS] Status check failed for ${externalId}: ${err.message}`);
      return null;
    }
  }
}

import prisma from '../config/database';
import { getSMSProvider } from './sms.service';
import logger from '../utils/logger';

/** Only rows this far back are re-checked, so the scan stays bounded. */
const LOOKBACK_HOURS = 48;
/** `sent` rows older than this with no carrier report are given up on. */
const GIVE_UP_HOURS = 24;
/** Cap per run so a large backlog cannot hammer the provider. */
const MAX_ROWS_PER_RUN = 20; // Semaphore permits 30 status requests per minute.

/**
 * Reconciles `sms_logs` with the SMS provider's real delivery state.
 *
 * A send only means the provider accepted the message; delivery is confirmed
 * later (or never, if the phone stays offline). Without this the log shows
 * "sent" for messages that were never delivered, which is exactly what made a
 * missing cancellation text look like a silent success. This polls the provider
 * for the batches still awaiting an outcome and updates their rows.
 */
class SMSDeliveryTrackerService {
  async reconcileRecent(): Promise<{ checked: number; updated: number; delivered: number; failed: number }> {
    const provider = getSMSProvider();
    if (!provider.getStatus) {
      // The configured provider exposes no status API (e.g. mock); nothing to do.
      return { checked: 0, updated: 0, delivered: 0, failed: 0 };
    }

    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    const rows = await prisma.sms_logs.findMany({
      where: {
        status: { in: ['queued', 'sent'] },
        external_id: { not: null },
        created_at: { gte: since },
      },
      orderBy: { created_at: 'desc' },
      take: MAX_ROWS_PER_RUN,
    });

    let checked = 0;
    let updated = 0;
    let delivered = 0;
    let failed = 0;

    for (const row of rows) {
      // TextBee stores `deviceId:batchId`; other providers use their own opaque id.
      // Either way getStatus decides whether it can interpret the value.
      if (!row.external_id || (provider.canTrack
        ? !provider.canTrack(row.external_id)
        : !row.external_id.includes(':'))) continue;

      checked++;
      let status;
      try {
        status = await provider.getStatus(row.external_id);
      } catch (err: any) {
        logger.warn(`[SMS TRACKER] Status check threw for log ${row.id}: ${err.message}`);
        continue;
      }

      if (!status) {
        // The batch could not be read (deleted device, unknown id) or has no
        // outcome yet. Give up after a day so rows do not sit unresolved
        // forever, which would repeat the original "silent success" problem.
        const ageMs = Date.now() - row.created_at.getTime();
        if (ageMs > GIVE_UP_HOURS * 60 * 60 * 1000) {
          await prisma.sms_logs.update({
            where: { id: row.id },
            data: {
              status: 'failed',
              error_message: row.error_message ?? 'No delivery confirmation from the SMS device',
            },
          });
          failed++;
          updated++;
        }
        continue;
      }

      // Never move a row backwards: once we have recorded "sent", a later
      // "queued" reading (e.g. a status-check that lost the batch) must not
      // regress it. Only delivered/failed, or queued->sent, are progress.
      const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, failed: 2 };
      const nextStatus = status.status;
      const isProgress = rank[nextStatus] > rank[row.status];
      const isTerminalTransition = (nextStatus === 'delivered' || nextStatus === 'failed') && row.status !== nextStatus;

      if (!isProgress && !isTerminalTransition) continue;

      const deliveredAt = status.deliveredAt ?? (nextStatus === 'delivered' ? new Date() : null);

      await prisma.sms_logs.update({
        where: { id: row.id },
        data: {
          status: nextStatus,
          sent_at: nextStatus === 'sent' || nextStatus === 'delivered' ? row.sent_at ?? new Date() : undefined,
          delivered_at: deliveredAt ?? undefined,
          error_message: nextStatus === 'failed' ? status.error ?? row.error_message ?? 'Delivery failed' : row.error_message,
        },
      });
      updated++;
      if (nextStatus === 'delivered') delivered++;
      if (nextStatus === 'failed') failed++;
    }

    if (updated > 0) {
      logger.info(
        `[SMS TRACKER] Reconciled ${updated}/${checked} logs (${delivered} delivered, ${failed} failed)`
      );
    }
    return { checked, updated, delivered, failed };
  }
}

export const smsDeliveryTrackerService = new SMSDeliveryTrackerService();
export default smsDeliveryTrackerService;

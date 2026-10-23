import prisma from '../config/database';
import { getSMSProvider } from './sms.service';
import logger from '../utils/logger';
import { NotificationType } from '@prisma/client';
import { env } from '../config/env';
import { normalizePhone } from '../utils/identity';
import {
  APPOINTMENT_BOOKED_MESSAGE,
  APPOINTMENT_CHECKED_IN_MESSAGE,
  APPOINTMENT_PLACED_MESSAGE,
  buildAppointmentCancelledSMS,
  buildAppointmentCancelledMessage,
  buildAppointmentCompletedMessage,
  isCompletionAllowedFrom,
  shouldNotifyStatusChange,
} from './appointment-notification-messages';

const SMS_GREETING = 'Hello, this is Souvari Skin Lab.';

interface DispatchParams {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  sendSMS?: boolean;
  smsPhone?: string;
  /** Complete SMS body, including branding, when different from the in-app message. */
  smsMessage?: string;
}

class NotificationDispatchService {
  async dispatch(params: DispatchParams): Promise<{ notification: any; smsSent: boolean }> {
    const { userId, type, title, message, data, sendSMS = false, smsPhone } = params;

    // 1. Create in-app notification
    const notification = await prisma.notifications.create({
      data: {
        user_id: userId,
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : null,
        status: 'unread',
      },
    });

    // 2. Send SMS if requested and phone is available
    let smsSent = false;
    if (sendSMS) {
      const recipient = normalizePhone(smsPhone) ?? null;
      if (!recipient) {
        // The request asked for an SMS but the account has no usable number.
        // Log loudly so a "no cancellation text" report is traceable instead of
        // looking like a silent success.
        logger.warn(
          `[NOTIFICATION] SMS skipped for user ${userId}: no valid phone number on file (raw: ${smsPhone ?? 'none'})`
        );
        return { notification, smsSent };
      }

      try {
        const provider = getSMSProvider();
        const smsText = params.smsMessage ?? `${SMS_GREETING} ${message}`;
        const result = await provider.send(recipient, smsText);

        await prisma.sms_logs.create({
          data: {
            user_id: userId,
            recipient_phone: recipient,
            message: smsText,
            // A successful send only means the provider accepted the message; it
            // starts as "queued" and the delivery tracker promotes it to
            // sent/delivered once the phone and carrier report back.
            status: result.success ? 'queued' : 'failed',
            external_id: result.externalId ?? null,
            error_message: result.error ?? null,
            sent_at: null,
          },
        });

        if (!result.success) {
          logger.warn(
            `[NOTIFICATION] SMS to ${recipient} for user ${userId} failed: ${result.error ?? 'unknown error'}`
          );
        }
        smsSent = result.success;
      } catch (err: any) {
        logger.error(`[NOTIFICATION] SMS failed for user ${userId}: ${err.message}`);
      }
    }

    return { notification, smsSent };
  }

  async dispatchAppointmentStatus(params: {
    appointmentId: number;
    oldStatus: string;
    newStatus: string;
    customerUserId: number;
    customerName: string;
    customerPhone?: string | null;
    staffUserId: number | null;
    staffName: string;
    serviceName: string;
    appointmentDate: string;
    appointmentTime: string;
    adminUserIds: number[];
  }): Promise<void> {
    const {
      appointmentId, oldStatus, newStatus,
      customerUserId, customerName, customerPhone,
      staffUserId, staffName,
      serviceName, appointmentDate, appointmentTime,
      adminUserIds,
    } = params;

    // Only a genuine status change warrants a customer notification. Re-saving
    // a booking or re-submitting the same status must not re-send a message.
    if (!shouldNotifyStatusChange(oldStatus, newStatus)) return;

    // A cancelled appointment is terminal for notification purposes: even if a
    // later write asserts it was completed, no completion message is sent.
    if (newStatus === 'completed' && !isCompletionAllowedFrom(oldStatus)) return;

    const statusMessages: Record<string, { title: string; message: string; type: NotificationType }> = {
      confirmed: {
        title: 'Appointment Booked',
        message: APPOINTMENT_BOOKED_MESSAGE,
        type: 'appointment_update',
      },
      checked_in: {
        title: 'Checked In',
        message: APPOINTMENT_CHECKED_IN_MESSAGE,
        type: 'appointment_update',
      },
      in_progress: {
        title: 'Session In Progress',
        message: `Your ${serviceName} session has started.`,
        type: 'appointment_update',
      },
      completed: {
        title: 'Session Completed',
        message: buildAppointmentCompletedMessage(env.REVIEW_URL),
        type: 'appointment_update',
      },
      no_show: {
        title: 'Appointment Marked No-Show',
        message: `Your appointment for ${serviceName} on ${appointmentDate} was marked as a no-show.`,
        type: 'appointment_update',
      },
    };

    const mapping = statusMessages[newStatus];
    if (!mapping) return;

    // Notify customer (in-app + SMS)
    await this.dispatch({
      userId: customerUserId,
      type: mapping.type,
      title: mapping.title,
      message: mapping.message,
      data: { appointment_id: appointmentId, old_status: oldStatus, new_status: newStatus },
      sendSMS: true,
      smsPhone: customerPhone ?? undefined,
    });

    // Notify assigned staff (in-app only)
    if (staffUserId) {
      const staffMessage = `Appointment #${appointmentId} for ${customerName} — ${serviceName} on ${appointmentDate} at ${appointmentTime} — status: ${newStatus.replace('_', ' ')}.`;

      await this.dispatch({
        userId: staffUserId,
        type: 'appointment_update',
        title: `Appointment Status: ${newStatus.replace('_', ' ')}`,
        message: staffMessage,
        data: { appointment_id: appointmentId, new_status: newStatus },
        sendSMS: false,
      });
    }

    // Notify admins (in-app only)
    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'appointment_update',
        title: `Appointment ${newStatus.replace('_', ' ')}`,
        message: `Appointment #${appointmentId}: ${customerName} — ${serviceName} on ${appointmentDate} at ${appointmentTime} — status: ${newStatus.replace('_', ' ')}.`,
        data: { appointment_id: appointmentId, new_status: newStatus },
        sendSMS: false,
      });
    }
  }

  /**
   * Cancellation always gets an automatic SMS to the customer, whether it was
   * initiated by an admin, by staff, or by the customer themselves. This is the
   * single send site for cancellations — `dispatchAppointmentStatus` does not
   * handle `cancelled`, so there is no risk of a duplicate message.
   */
  async dispatchAppointmentCancelled(params: {
    appointmentId: number;
    customerUserId: number;
    customerName: string;
    customerPhone?: string | null;
    staffUserId: number | null;
    staffName: string;
    serviceName: string;
    appointmentDate: string;
    appointmentTime: string;
    reason?: string | null;
    cancelledByCustomer?: boolean;
    adminUserIds: number[];
  }): Promise<void> {
    const {
      appointmentId, customerUserId, customerName, customerPhone,
      staffUserId, staffName, serviceName,
      appointmentDate, appointmentTime, reason,
      cancelledByCustomer, adminUserIds,
    } = params;

    const customerMessage = buildAppointmentCancelledMessage(reason);

    // Notify customer (in-app + SMS) — SMS is unconditional
    await this.dispatch({
      userId: customerUserId,
      type: 'appointment_update',
      title: 'Appointment Cancelled',
      message: customerMessage,
      smsMessage: buildAppointmentCancelledSMS(appointmentDate, appointmentTime, reason),
      data: { appointment_id: appointmentId, new_status: 'cancelled', cancelled_by_customer: !!cancelledByCustomer },
      sendSMS: true,
      smsPhone: customerPhone ?? undefined,
    });

    // Notify assigned staff (in-app only)
    if (staffUserId) {
      await this.dispatch({
        userId: staffUserId,
        type: 'appointment_update',
        title: 'Appointment Cancelled',
        message: `Appointment #${appointmentId} for ${customerName} on ${appointmentDate} has been cancelled.`,
        data: { appointment_id: appointmentId, new_status: 'cancelled' },
        sendSMS: false,
      });
    }

    // Notify admins (in-app only)
    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'appointment_update',
        title: 'Appointment Cancelled',
        message: `Appointment #${appointmentId}: ${customerName} — ${serviceName} on ${appointmentDate} at ${appointmentTime} has been cancelled.`,
        data: { appointment_id: appointmentId, new_status: 'cancelled' },
        sendSMS: false,
      });
    }
  }

  /**
   * Tells the customer their booking now covers a different set of services —
   * e.g. they added a service at the counter. Customer gets in-app + SMS.
   */
  async dispatchAppointmentServicesChanged(params: {
    appointmentId: number;
    customerUserId: number;
    customerName: string;
    customerPhone?: string | null;
    staffUserId: number | null;
    staffName: string;
    serviceNames: string[];
    addedServiceNames: string[];
    appointmentDate: string;
    appointmentTime: string;
    newEndTime: string;
    quotedPrice: number;
    note?: string | null;
    adminUserIds: number[];
  }): Promise<void> {
    const {
      appointmentId, customerUserId, customerName, customerPhone,
      staffUserId, staffName, serviceNames, addedServiceNames,
      appointmentDate, appointmentTime, newEndTime,
      quotedPrice, note, adminUserIds,
    } = params;

    const serviceList = serviceNames.join(', ');
    const addedText = addedServiceNames.length
      ? ` ${addedServiceNames.join(', ')} ${addedServiceNames.length === 1 ? 'was' : 'were'} added.`
      : '';
    const noteText = note?.trim() ? ` Note: ${note.trim()}` : '';
    const extended = ` Your session now ends at ${newEndTime}.`;

    const message =
      `Your appointment on ${appointmentDate} at ${appointmentTime} now covers: ${serviceList}.` +
      `${addedText}${extended} Total: PHP ${Number(quotedPrice).toLocaleString()}.${noteText}`;

    // Notify customer (in-app + SMS)
    await this.dispatch({
      userId: customerUserId,
      type: 'appointment_update',
      title: 'Appointment Services Updated',
      message,
      data: {
        appointment_id: appointmentId,
        services: serviceNames,
        added_services: addedServiceNames,
      },
      sendSMS: true,
      smsPhone: customerPhone ?? undefined,
    });

    // Notify assigned staff (in-app only)
    if (staffUserId) {
      await this.dispatch({
        userId: staffUserId,
        type: 'appointment_update',
        title: 'Appointment Services Updated',
        message: `Appointment #${appointmentId} for ${customerName} on ${appointmentDate} now covers: ${serviceList} (ends ${newEndTime}).`,
        data: { appointment_id: appointmentId, services: serviceNames },
        sendSMS: false,
      });
    }

    // Notify admins (in-app only)
    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'appointment_update',
        title: 'Appointment Services Updated',
        message: `Appointment #${appointmentId}: ${customerName} with ${staffName} on ${appointmentDate} now covers: ${serviceList} (ends ${newEndTime}).`,
        data: { appointment_id: appointmentId, services: serviceNames },
        sendSMS: false,
      });
    }
  }

  async dispatchAppointmentRescheduled(params: {
    appointmentId: number;
    customerUserId: number;
    customerName: string;
    customerPhone?: string | null;
    staffUserId: number | null;
    staffName: string;
    serviceName: string;
    oldDate: string;
    oldTime: string;
    newDate: string;
    newTime: string;
    reason?: string | null;
    adminUserIds: number[];
  }): Promise<void> {
    const {
      appointmentId, customerUserId, customerName, customerPhone,
      staffUserId, staffName, serviceName,
      oldDate, oldTime, newDate, newTime, reason, adminUserIds,
    } = params;

    const reasonText = reason?.trim() ? ` Reason: ${reason.trim()}` : '';

    // Notify customer (in-app + SMS)
    await this.dispatch({
      userId: customerUserId,
      type: 'appointment_update',
      title: 'Appointment Rescheduled',
      message: `Your ${serviceName} appointment has been rescheduled from ${oldDate} at ${oldTime} to ${newDate} at ${newTime}.${reasonText}`,
      data: { appointment_id: appointmentId, rescheduled: true, reason: reason?.trim() ?? null },
      sendSMS: true,
      smsPhone: customerPhone ?? undefined,
    });

    // Notify assigned staff (in-app only)
    if (staffUserId) {
      await this.dispatch({
        userId: staffUserId,
        type: 'appointment_update',
        title: 'Appointment Rescheduled',
        message: `Appointment #${appointmentId} for ${customerName} — ${serviceName} has been rescheduled from ${oldDate} at ${oldTime} to ${newDate} at ${newTime}.`,
        data: { appointment_id: appointmentId, rescheduled: true },
        sendSMS: false,
      });
    }

    // Notify admins (in-app only)
    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'appointment_update',
        title: 'Appointment Rescheduled',
        message: `Appointment #${appointmentId}: ${customerName} — ${serviceName} rescheduled from ${oldDate} at ${oldTime} to ${newDate} at ${newTime} by ${staffName}.`,
        data: { appointment_id: appointmentId, rescheduled: true },
        sendSMS: false,
      });
    }
  }

  async dispatchNewBooking(params: {
    appointmentId: number;
    customerUserId: number;
    customerName: string;
    customerPhone?: string | null;
    staffUserId: number;
    staffName: string;
    serviceName: string;
    appointmentDate: string;
    appointmentTime: string;
    quotedPrice: number | null;
    status: string;
    adminUserIds: number[];
  }): Promise<void> {
    const {
      appointmentId, customerUserId, customerName, customerPhone,
      staffUserId, staffName, serviceName,
      appointmentDate, appointmentTime, quotedPrice, status, adminUserIds,
    } = params;

    // A staff/admin booking is entered already confirmed by the clinic, so the
    // customer receives the "booked" message. A self-service customer request
    // is still pending and must only hear that it was *placed*.
    const confirmedAtCreation = status === 'confirmed';
    const customerTitle = confirmedAtCreation ? 'Appointment Booked' : 'Appointment Placed';
    const customerMessage = confirmedAtCreation ? APPOINTMENT_BOOKED_MESSAGE : APPOINTMENT_PLACED_MESSAGE;

    // Notify customer (in-app + SMS)
    await this.dispatch({
      userId: customerUserId,
      type: 'appointment_reminder',
      title: customerTitle,
      message: customerMessage,
      data: { appointment_id: appointmentId, status },
      sendSMS: true,
      smsPhone: customerPhone ?? undefined,
    });

    // Notify assigned staff (in-app only)
    await this.dispatch({
      userId: staffUserId,
      type: 'appointment_reminder',
      title: 'New Appointment',
      message: `New booking: ${customerName} booked ${serviceName} for ${appointmentDate} at ${appointmentTime}.`,
      data: { appointment_id: appointmentId },
      sendSMS: false,
    });

    // Notify admins (in-app only)
    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'appointment_reminder',
        title: 'New Booking',
        message: `New booking: ${customerName} booked ${serviceName} with ${staffName} for ${appointmentDate} at ${appointmentTime}.`,
        data: { appointment_id: appointmentId },
        sendSMS: false,
      });
    }
  }

  async getAdminUserIds(): Promise<number[]> {
    const admins = await prisma.users.findMany({
      where: { role: 'admin', deleted_at: null },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  async dispatchMembershipDownpayment(params: {
    customerUserId: number;
    planName: string;
    planPrice: number;
    amountPaid: number;
    balance: number;
    dueDate: Date | null;
    customerPhone?: string;
    adminUserIds: number[];
  }): Promise<void> {
    const { customerUserId, planName, planPrice, amountPaid, balance, dueDate, customerPhone, adminUserIds } = params;
    const balanceStr = `₱${balance.toLocaleString()}`;
    const dueStr = dueDate ? new Date(dueDate).toLocaleDateString() : 'soon';

    await this.dispatch({
      userId: customerUserId,
      type: 'payment',
      title: 'Membership Activated — Balance Due',
      message: `Your ${planName} membership is now active. You paid ₱${amountPaid.toLocaleString()} of ₱${planPrice.toLocaleString()}. Balance of ${balanceStr} is due by ${dueStr}.`,
      data: { plan: planName, balance, due_date: dueDate },
      sendSMS: true,
      smsPhone: customerPhone,
    });

    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'payment',
        title: 'Membership Downpayment Received',
        message: `A customer activated ${planName} with a downpayment. Remaining balance: ${balanceStr} due by ${dueStr}.`,
        data: { balance, due_date: dueDate },
        sendSMS: false,
      });
    }
  }

  async dispatchMembershipFull(params: {
    customerUserId: number;
    planName: string;
    planPrice: number;
    customerPhone?: string;
    adminUserIds: number[];
  }): Promise<void> {
    const { customerUserId, planName, planPrice, customerPhone, adminUserIds } = params;

    await this.dispatch({
      userId: customerUserId,
      type: 'payment',
      title: 'Membership Activated',
      message: `Your ${planName} membership is now active. Full payment of ₱${planPrice.toLocaleString()} received. Welcome to Souvari Skin Lab!`,
      data: { plan: planName, amount: planPrice },
      sendSMS: true,
      smsPhone: customerPhone,
    });

    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'payment',
        title: 'Membership Fully Paid',
        message: `A customer paid in full for ${planName} — ₱${planPrice.toLocaleString()}.`,
        data: { plan: planName, amount: planPrice },
        sendSMS: false,
      });
    }
  }

  async dispatchPayInStoreRequest(params: {
    customerUserId: number;
    customerName: string;
    planName: string;
    balance: number;
    adminUserIds: number[];
  }): Promise<void> {
    const { customerUserId, customerName, planName, balance, adminUserIds } = params;
    const balanceStr = `₱${balance.toLocaleString()}`;

    await this.dispatch({
      userId: customerUserId,
      type: 'payment',
      title: 'Payment at Store Requested',
      message: `We've noted you'll settle your remaining ${balanceStr} balance for ${planName} at the clinic. Please visit us — the clinic has been notified.`,
      data: { balance, plan: planName },
      sendSMS: false,
    });

    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'payment',
        title: 'Balance Payment At Store',
        message: `${customerName} requested to pay their ${planName} remaining balance (${balanceStr}) at the store. Collect it from Memberships.`,
        data: { balance, plan: planName },
        sendSMS: false,
      });
    }
  }

  async dispatchMembershipBalanceSettled(params: {
    customerUserId: number;
    customerName: string;
    planName: string;
    collectedAmount: number;
    customerPhone?: string;
    adminUserIds: number[];
  }): Promise<void> {
    const { customerUserId, customerName, planName, collectedAmount, customerPhone, adminUserIds } = params;
    const amountStr = `₱${collectedAmount.toLocaleString()}`;

    await this.dispatch({
      userId: customerUserId,
      type: 'payment',
      title: 'Membership Balance Settled',
      message: `Thank you! Your ${planName} membership is now fully paid.`,
      data: { plan: planName },
      sendSMS: true,
      smsPhone: customerPhone,
    });

    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'payment',
        title: 'Membership Balance Collected',
        message: `${customerName}'s ${planName} membership balance was collected in-store — ${amountStr}.`,
        data: { plan: planName, amount: collectedAmount },
        sendSMS: false,
      });
    }
  }

  async dispatchMembershipBalanceReminder(params: {
    customerUserId: number;
    planName: string;
    balance: number;
    dueDate: Date | null;
    customerPhone?: string;
  }): Promise<void> {
    const { customerUserId, planName, balance, dueDate, customerPhone } = params;
    const balanceStr = `₱${balance.toLocaleString()}`;
    const dueStr = dueDate ? new Date(dueDate).toLocaleDateString() : 'today';

    await this.dispatch({
      userId: customerUserId,
      type: 'payment',
      title: 'Membership Balance Due Today',
      message: `Your remaining ${balanceStr} balance for ${planName} is due today (${dueStr}). Please pay to keep your membership active, or it will be marked failed.`,
      data: { balance, due_date: dueDate, plan: planName },
      sendSMS: true,
      smsPhone: customerPhone,
    });
  }

  async dispatchMembershipFailed(params: {
    customerUserId: number;
    customerName: string;
    planName: string;
    balance: number;
    adminUserIds: number[];
  }): Promise<void> {
    const { customerUserId, customerName, planName, balance, adminUserIds } = params;
    const balanceStr = `₱${balance.toLocaleString()}`;

    await this.dispatch({
      userId: customerUserId,
      type: 'payment',
      title: 'Membership Failed — Balance Unpaid',
      message: `Your ${planName} membership was marked failed because the remaining balance (${balanceStr}) was not paid by the due date. Please contact the clinic to make arrangements.`,
      data: { balance, plan: planName },
      sendSMS: true,
      smsPhone: undefined,
    });

    for (const adminId of adminUserIds) {
      await this.dispatch({
        userId: adminId,
        type: 'payment',
        title: 'Membership Marked Failed',
        message: `${customerName}'s ${planName} membership was marked failed — ${balanceStr} balance was unpaid past the due date.`,
        data: { balance, plan: planName },
        sendSMS: false,
      });
    }
  }
}

export const notificationDispatch = new NotificationDispatchService();

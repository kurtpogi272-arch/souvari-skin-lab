import type { NotificationType } from '@prisma/client';
import { buildSmsGreeting, shortenSmsNote, smsFirstName } from './sms-message-format';

/**
 * Canonical, status-specific appointment messages for the customer.
 *
 * Each message corresponds to exactly one lifecycle event so a booking can
 * never be described as something it is not (e.g. a newly placed request must
 * not read as an already-confirmed booking).
 */

/** Default reason stored when a customer cancels their own appointment. */
export const CUSTOMER_CANCEL_REASON = 'Cancelled by customer';

/** Appointment placed — pending confirmation. */
export const APPOINTMENT_PLACED_MESSAGE =
  'Your appointment has been placed! Thank you for choosing Souvari Skin Lab. ' +
  'Your appointment is currently awaiting confirmation from our team. ' +
  'We\u2019ll notify you once your appointment has been confirmed.';

/** Appointment booked — confirmed by the admin. */
export const APPOINTMENT_BOOKED_MESSAGE =
  'Good news! Your appointment has been booked at Souvari Skin Lab. ' +
  'We look forward to welcoming you! Please refer to your appointment details ' +
  'for your scheduled date and time.';

/** Client checked in at the clinic. */
export const APPOINTMENT_CHECKED_IN_MESSAGE =
  "Welcome to Souvari Skin Lab! You've been checked in for your appointment. " +
  "We're happy to have you with us today.";

/** Appointment cancelled. */
export const APPOINTMENT_CANCELLED_MESSAGE =
  "Your appointment at Souvari Skin Lab has been cancelled. " +
  "We're sorry we won't be seeing you this time. " +
  "If you'd like to schedule another appointment, please contact us or book a new appointment. " +
  'We hope to welcome you soon!';

/** Keep the cancellation SMS brief; detailed reasons are available in-app. */
export function buildAppointmentCancelledSMS(appointmentDate: string, appointmentTime: string, reason?: string | null, firstName?: string | null): string {
  const date = appointmentDate.replace(/\b(January|February|March|April|June|July|August|September|October|November|December)\b/g, (month) => month.slice(0, 3));
  let message = `${buildSmsGreeting(firstName)} Your ${date} ${appointmentTime} appointment is cancelled.`;
  let ending = ' Contact us to rebook.';
  if (message.length + ending.length > 160) ending = '';
  if (message.length > 160) {
    const name = smsFirstName(firstName);
    message = `${name ? `Hi ${name}, ` : ''}Souvari Skin Lab: ${date} ${appointmentTime} cancelled.`;
  }
  const note = reason?.trim().replace(/\s+/g, ' ');
  if (!note || note === CUSTOMER_CANCEL_REASON) return `${message}${ending}`;
  const shortened = shortenSmsNote(note, 160 - message.length - ending.length - ' Reason: '.length - (ending ? 1 : 0));
  const separator = shortened && ending && !/[.!?]$/.test(shortened) ? '.' : '';
  return `${message}${shortened ? ` Reason: ${shortened}` : ''}${separator}${ending}`;
}

/** Appointment completed — thank-you and review request. */
export const APPOINTMENT_COMPLETED_MESSAGE =
  'Thank you for visiting Souvari Skin Lab! We hope you enjoyed your experience with us. ' +
  'Your trust means so much to our team. If you have a moment, we would greatly appreciate it ' +
  'if you could leave us a review and share your experience. Your feedback helps us continue ' +
  'improving our services. We look forward to seeing you again!';

export interface StatusNotification {
  title: string;
  message: string;
  type: NotificationType;
}

/**
 * A review link is only valid when it parses as an absolute http(s) URL.
 * Anything else (empty, relative, malformed) is ignored so no invented or
 * broken link ever reaches a customer.
 */
function isValidReviewUrl(url?: string | null): boolean {
  if (!url || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Message sent the moment a booking request is created while still pending. */
export function buildAppointmentPlacedMessage(): string {
  return APPOINTMENT_PLACED_MESSAGE;
}

/** Message sent once an admin (or staff) confirms a pending appointment. */
export function buildAppointmentBookedMessage(): string {
  return APPOINTMENT_BOOKED_MESSAGE;
}

/** Message sent when the client arrives and is checked in. */
export function buildAppointmentCheckedInMessage(): string {
  return APPOINTMENT_CHECKED_IN_MESSAGE;
}

/**
 * Cancellation message. The stored reason is appended only when it is a real,
 * staff-supplied reason — the generic customer self-cancel placeholder adds no
 * information and is omitted.
 */
export function buildAppointmentCancelledMessage(reason?: string | null): string {
  const trimmed = reason?.trim();
  if (trimmed && trimmed !== CUSTOMER_CANCEL_REASON) {
    return `${APPOINTMENT_CANCELLED_MESSAGE} Reason: ${trimmed}`;
  }
  return APPOINTMENT_CANCELLED_MESSAGE;
}

/**
 * Completion message. If a valid review URL is configured it is appended;
 * otherwise the message is sent exactly as written.
 */
export function buildAppointmentCompletedMessage(reviewUrl?: string | null): string {
  if (isValidReviewUrl(reviewUrl)) {
    return `${APPOINTMENT_COMPLETED_MESSAGE} Leave us a review: ${reviewUrl!.trim()}`;
  }
  return APPOINTMENT_COMPLETED_MESSAGE;
}

/** Whether a completion notification may be sent from the given prior status. */
export function isCompletionAllowedFrom(oldStatus: string): boolean {
  return oldStatus !== 'cancelled';
}

/**
 * A notification is only warranted by an actual status change. Re-saving an
 * appointment with the same status, or presenting it, must be silent.
 */
export function shouldNotifyStatusChange(oldStatus: string, newStatus: string): boolean {
  return oldStatus !== newStatus;
}

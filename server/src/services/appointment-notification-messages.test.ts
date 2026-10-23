import { describe, it, expect } from 'vitest';
import {
  APPOINTMENT_BOOKED_MESSAGE,
  APPOINTMENT_CHECKED_IN_MESSAGE,
  APPOINTMENT_PLACED_MESSAGE,
  APPOINTMENT_CANCELLED_MESSAGE,
  APPOINTMENT_COMPLETED_MESSAGE,
  CUSTOMER_CANCEL_REASON,
  buildAppointmentCancelledMessage,
  buildAppointmentCancelledSMS,
  buildAppointmentCompletedMessage,
  isCompletionAllowedFrom,
  shouldNotifyStatusChange,
} from './appointment-notification-messages';

describe('appointment-notification-messages', () => {
  it('returns exact placed message', () => {
    expect(APPOINTMENT_PLACED_MESSAGE).toBe(
      'Your appointment has been placed! Thank you for choosing Souvari Skin Lab. Your appointment is currently awaiting confirmation from our team. We\u2019ll notify you once your appointment has been confirmed.'
    );
  });

  it('returns exact booked message', () => {
    expect(APPOINTMENT_BOOKED_MESSAGE).toBe(
      'Good news! Your appointment has been booked at Souvari Skin Lab. We look forward to welcoming you! Please refer to your appointment details for your scheduled date and time.'
    );
  });

  it('returns exact checked-in message', () => {
    expect(APPOINTMENT_CHECKED_IN_MESSAGE).toBe(
      "Welcome to Souvari Skin Lab! You've been checked in for your appointment. We're happy to have you with us today."
    );
  });

  it('returns exact cancelled message', () => {
    expect(APPOINTMENT_CANCELLED_MESSAGE).toBe(
      "Your appointment at Souvari Skin Lab has been cancelled. We're sorry we won't be seeing you this time. If you'd like to schedule another appointment, please contact us or book a new appointment. We hope to welcome you soon!"
    );
  });

  it('returns exact completed message (no link)', () => {
    expect(APPOINTMENT_COMPLETED_MESSAGE).toBe(
      'Thank you for visiting Souvari Skin Lab! We hope you enjoyed your experience with us. Your trust means so much to our team. If you have a moment, we would greatly appreciate it if you could leave us a review and share your experience. Your feedback helps us continue improving our services. We look forward to seeing you again!'
    );
  });

  it('cancellation does not append generic customer reason', () => {
    expect(buildAppointmentCancelledMessage(CUSTOMER_CANCEL_REASON)).toBe(
      APPOINTMENT_CANCELLED_MESSAGE
    );
    expect(buildAppointmentCancelledMessage('  ')).toBe(APPOINTMENT_CANCELLED_MESSAGE);
    expect(buildAppointmentCancelledMessage(null)).toBe(APPOINTMENT_CANCELLED_MESSAGE);
    expect(buildAppointmentCancelledMessage(undefined)).toBe(APPOINTMENT_CANCELLED_MESSAGE);
  });

  it('cancellation appends non-generic reason when present', () => {
    expect(buildAppointmentCancelledMessage('Patient had emergency')).toBe(
      `${APPOINTMENT_CANCELLED_MESSAGE} Reason: Patient had emergency`
    );
  });

  it('includes the website cancellation note in the SMS', () => {
    expect(buildAppointmentCancelledSMS('October 23, 2026', '14:00', '  Staff unavailable  ')).toBe(
      'Hi this is Souvari Skin Lab, Your appointment for October 23, 2026 at 14:00 has been cancelled. Please contact us to rebook. Reason: Staff unavailable'
    );
  });

  it('omits an empty or automatic placeholder reason from the SMS', () => {
    const message = buildAppointmentCancelledSMS('October 23, 2026', '14:00');
    expect(buildAppointmentCancelledSMS('October 23, 2026', '14:00', '  ')).toBe(message);
    expect(buildAppointmentCancelledSMS('October 23, 2026', '14:00', CUSTOMER_CANCEL_REASON)).toBe(message);
  });

  it('completion appends review link only if valid', () => {
    expect(buildAppointmentCompletedMessage('https://example.com/review')).toBe(
      `${APPOINTMENT_COMPLETED_MESSAGE} Leave us a review: https://example.com/review`
    );
    expect(buildAppointmentCompletedMessage('http://example.com/review')).toBe(
      `${APPOINTMENT_COMPLETED_MESSAGE} Leave us a review: http://example.com/review`
    );
    expect(buildAppointmentCompletedMessage('')).toBe(APPOINTMENT_COMPLETED_MESSAGE);
    expect(buildAppointmentCompletedMessage('  ')).toBe(APPOINTMENT_COMPLETED_MESSAGE);
    expect(buildAppointmentCompletedMessage('not-a-url')).toBe(APPOINTMENT_COMPLETED_MESSAGE);
    expect(buildAppointmentCompletedMessage('/review')).toBe(APPOINTMENT_COMPLETED_MESSAGE);
  });

  it('suppresses completion notification if cancelled was the prior status', () => {
    expect(isCompletionAllowedFrom('cancelled')).toBe(false);
    expect(isCompletionAllowedFrom('confirmed')).toBe(true);
    expect(isCompletionAllowedFrom('pending')).toBe(true);
  });

  it('only notifies on genuine status change', () => {
    expect(shouldNotifyStatusChange('pending', 'pending')).toBe(false);
    expect(shouldNotifyStatusChange('pending', 'confirmed')).toBe(true);
    expect(shouldNotifyStatusChange('cancelled', 'completed')).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createNotification, createLog, send, findCustomer } = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ id: 1 }),
  createLog: vi.fn().mockResolvedValue({ id: 1 }),
  send: vi.fn().mockResolvedValue({ success: true, externalId: 'device:batch' }),
  findCustomer: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: { notifications: { create: createNotification }, sms_logs: { create: createLog }, customers: { findUnique: findCustomer } },
}));
vi.mock('./sms.service', () => ({ getSMSProvider: () => ({ send }) }));
vi.mock('../config/env', () => ({ env: {} }));

import { notificationDispatch } from './notification-dispatch.service';

describe('cancellation SMS dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findCustomer.mockResolvedValue({ first_name: 'Mary Anne' });
  });

  it('sends a single-segment SMS with the appointment date and time while retaining the reason in-app', async () => {
    const reason = 'The clinic needs to reschedule this appointment. '.repeat(10);
    await notificationDispatch.dispatchAppointmentCancelled({
      appointmentId: 1, customerUserId: 2, customerName: 'Test Customer',
      customerPhone: '+639932404323', staffUserId: null, staffName: 'Test Staff',
      serviceName: 'Consultation', appointmentDate: 'September 23, 2026',
      appointmentTime: '14:00', reason, adminUserIds: [],
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [recipient, expected] = send.mock.calls[0];
    expect(recipient).toBe('+639932404323');
    expect(expected).toMatch(/^Hi Mary Anne, this is Souvari Skin Lab\. Your Sep 23, 2026 14:00 appointment is cancelled\. Reason: The clinic/);
    expect(expected).toContain('...');
    expect(expected.length).toBeLessThanOrEqual(160);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ message: expect.stringContaining(reason.trim()) }),
    }));
    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ message: expected }),
    }));
  });

  it.each(['Appointment Placed', 'Appointment Booked', 'Appointment Reminder', 'Membership Activated', 'Membership Balance Due Today'])(
    'uses the saved compound first name in %s SMS without changing the in-app message', async (title) => {
      await notificationDispatch.dispatch({
        userId: 2, type: 'appointment_update', title, message: 'Your account update.',
        sendSMS: true, smsPhone: '+639932404323',
      });
      expect(send).toHaveBeenCalledExactlyOnceWith('+639932404323', 'Hi Mary Anne, this is Souvari Skin Lab. Your account update.');
      expect(findCustomer).toHaveBeenCalledWith({ where: { user_id: 2 }, select: { first_name: true } });
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: 'Your account update.' }) }));
    },
  );

  it.each([null, { first_name: '' }, { first_name: '  ' }])('uses a clean generic greeting when the first name is missing', async (customer) => {
    findCustomer.mockResolvedValue(customer);
    await notificationDispatch.dispatch({ userId: 2, type: 'payment', title: 'Payment', message: 'Payment received.', sendSMS: true, smsPhone: '+639932404323' });
    expect(send).toHaveBeenCalledExactlyOnceWith('+639932404323', 'Hi, this is Souvari Skin Lab. Payment received.');
  });

  it('still sends an SMS if optional name retrieval fails', async () => {
    findCustomer.mockRejectedValue(new Error('Read temporarily unavailable'));
    await notificationDispatch.dispatch({ userId: 2, type: 'payment', title: 'Payment', message: 'Payment received.', sendSMS: true, smsPhone: '+639932404323' });
    expect(send).toHaveBeenCalledExactlyOnceWith('+639932404323', 'Hi, this is Souvari Skin Lab. Payment received.');
  });

  it('does not look up names or send SMS for in-app-only notifications', async () => {
    await notificationDispatch.dispatch({ userId: 2, type: 'payment', title: 'Payment', message: 'Payment received.', sendSMS: false });
    expect(findCustomer).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createNotification, createLog, send } = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ id: 1 }),
  createLog: vi.fn().mockResolvedValue({ id: 1 }),
  send: vi.fn().mockResolvedValue({ success: true, externalId: 'device:batch' }),
}));

vi.mock('../config/database', () => ({
  default: { notifications: { create: createNotification }, sms_logs: { create: createLog } },
}));
vi.mock('./sms.service', () => ({ getSMSProvider: () => ({ send }) }));
vi.mock('../config/env', () => ({ env: {} }));

import { notificationDispatch } from './notification-dispatch.service';

describe('cancellation SMS dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(expected).toMatch(/^Hi this is Souvari Skin Lab, Your appointment for September 23, 2026 at 14:00 has been cancelled\. Please contact us to rebook\. Reason: The clinic/);
    expect(expected).toMatch(/\.\.\.$/);
    expect(expected.length).toBeLessThanOrEqual(160);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ message: expect.stringContaining(reason.trim()) }),
    }));
    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ message: expected }),
    }));
  });
});

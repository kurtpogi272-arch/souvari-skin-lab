import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany, update, getStatus } = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
  getStatus: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    sms_logs: { findMany, update },
  },
}));

vi.mock('./sms.service', () => ({
  getSMSProvider: () => ({
    getStatus,
    canTrack: (id: string) => id.startsWith('device-123:') || /^semaphore:\d+$/.test(id),
  }),
}));

import { smsDeliveryTrackerService } from './sms-delivery-tracker.service';

function row(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    status: 'sent',
    external_id: 'device-123:batch-abc',
    error_message: null,
    delivered_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

describe('sms-delivery-tracker', () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockClear();
    getStatus.mockReset();
  });

  it('marks a batch delivered when the provider confirms it', async () => {
    findMany.mockResolvedValue([row()]);
    getStatus.mockResolvedValue({ status: 'delivered', deliveredAt: new Date('2026-10-23T04:23:13Z') });

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result).toMatchObject({ checked: 1, updated: 1, delivered: 1 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: 'delivered' }),
      })
    );
  });

  it('marks a batch failed when the provider reports a failure', async () => {
    findMany.mockResolvedValue([row()]);
    getStatus.mockResolvedValue({ status: 'failed', error: 'No signal' });

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result).toMatchObject({ updated: 1, failed: 1 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', error_message: 'No signal' }),
      })
    );
  });

  it('leaves a still-queued message untouched', async () => {
    findMany.mockResolvedValue([row()]);
    getStatus.mockResolvedValue({ status: 'queued' });

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result.updated).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('gives up on a send with no confirmation after a day', async () => {
    findMany.mockResolvedValue([row({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000) })]);
    getStatus.mockResolvedValue(null);

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result.failed).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('keeps a recent send with no confirmation as-is (still waiting)', async () => {
    findMany.mockResolvedValue([row({ status: 'queued' })]);
    getStatus.mockResolvedValue(null);

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result.updated).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('gives up on a queued send with no confirmation after a day', async () => {
    findMany.mockResolvedValue([row({ status: 'queued', created_at: new Date(Date.now() - 25 * 60 * 60 * 1000) })]);
    getStatus.mockResolvedValue(null);

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result.failed).toBe(1);
  });

  it('skips legacy external ids that carry no batch reference', async () => {
    findMany.mockResolvedValue([row({ external_id: 'textbee-1792685709388' })]);

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result.checked).toBe(0);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('records network acceptance for a Semaphore message without marking it delivered', async () => {
    findMany.mockResolvedValue([row({ status: 'queued', external_id: 'semaphore:123', sent_at: null })]);
    getStatus.mockResolvedValue({ status: 'sent' });

    const result = await smsDeliveryTrackerService.reconcileRecent();

    expect(result).toMatchObject({ checked: 1, updated: 1, delivered: 0 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', sent_at: expect.any(Date), delivered_at: undefined }),
    }));
  });

  it('does not fail old messages belonging to another device or provider', async () => {
    findMany.mockResolvedValue([row({
      external_id: 'other-provider:123', created_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
    })]);
    const result = await smsDeliveryTrackerService.reconcileRecent();
    expect(result.checked).toBe(0);
    expect(getStatus).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/env', () => ({
  env: {
    SMS_API_KEY: 'test-key',
    TEXTBEE_DEVICE_ID: 'device-123',
  },
}));

import { TextBeeSMSProvider } from './textbee-sms.provider';

const originalFetch = global.fetch;

function mockFetchOnce(handler: (url: string, init?: any) => any) {
  global.fetch = vi.fn(async (url: any, init?: any) => {
    const result = handler(String(url), init);
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: async () => result.body,
    } as any;
  }) as any;
}

describe('TextBeeSMSProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('send', () => {
    it('posts to the account-level send endpoint with the device in the body', async () => {
      let captured: any;
      mockFetchOnce((url, init) => {
        captured = { url, init };
        return { ok: true, body: { data: { success: true, smsBatchId: 'batch-abc', recipientCount: 1 } } };
      });

      const provider = new TextBeeSMSProvider();
      const result = await provider.send('+639171234567', 'hello');

      expect(result.success).toBe(true);
      expect(captured.url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
      const body = JSON.parse(captured.init.body);
      expect(body.recipients).toEqual(['+639171234567']);
      expect(body.deviceId).toBe('device-123');
    });

    it('stores deviceId:batchId as the external id for later tracking', async () => {
      mockFetchOnce(() => ({ ok: true, body: { data: { success: true, smsBatchId: 'batch-abc' } } }));

      const provider = new TextBeeSMSProvider();
      const result = await provider.send('+639171234567', 'hello');

      expect(result.externalId).toBe('device-123:batch-abc');
    });

    it('reports failure with the provider message on a non-2xx response', async () => {
      mockFetchOnce(() => ({ ok: false, status: 429, body: { message: 'Plan limit reached' } }));

      const provider = new TextBeeSMSProvider();
      const result = await provider.send('+639171234567', 'hello');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Plan limit reached');
    });
  });

  describe('getStatus', () => {
    function batchResponse(batch: any, messages: any[] = []) {
      return { ok: true, body: { data: { batch, messages } } };
    }

    it('returns delivered once every recipient is confirmed', async () => {
      mockFetchOnce(() =>
        batchResponse(
          { recipientCount: 1, deliveredCount: 1, failureCount: 0, successCount: 1, status: 'completed' },
          [{ status: 'delivered', deliveredAt: '2026-10-23T04:23:13.143Z' }]
        )
      );

      const status = await new TextBeeSMSProvider().getStatus('device-123:batch-abc');
      expect(status?.status).toBe('delivered');
      expect(status?.deliveredAt?.toISOString()).toBe('2026-10-23T04:23:13.143Z');
    });

    it('returns failed when every recipient failed', async () => {
      mockFetchOnce(() =>
        batchResponse(
          { recipientCount: 1, deliveredCount: 0, failureCount: 1, successCount: 0, status: 'failed' },
          [{ status: 'failed', errorMessage: 'No signal' }]
        )
      );

      const status = await new TextBeeSMSProvider().getStatus('device-123:batch-abc');
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('No signal');
    });

    it('reports sent when the device dispatched but the carrier has not confirmed', async () => {
      mockFetchOnce(() =>
        batchResponse(
          { recipientCount: 1, deliveredCount: 0, failureCount: 0, successCount: 1, status: 'completed' },
          [{ status: 'sent', sentAt: '2026-10-23T04:23:11.130Z' }]
        )
      );

      const status = await new TextBeeSMSProvider().getStatus('device-123:batch-abc');
      expect(status?.status).toBe('sent');
    });

    it('reports queued while the batch is still processing', async () => {
      mockFetchOnce(() =>
        batchResponse(
          { recipientCount: 1, deliveredCount: 0, failureCount: 0, successCount: 0, status: 'processing' },
          [{ status: 'pending' }]
        )
      );

      const status = await new TextBeeSMSProvider().getStatus('device-123:batch-abc');
      expect(status?.status).toBe('queued');
    });

    it('returns null when the external id has no batch (e.g. legacy rows)', async () => {
      const status = await new TextBeeSMSProvider().getStatus('textbee-1792685709388');
      expect(status).toBeNull();
    });

    it('returns null when the batch is not found', async () => {
      mockFetchOnce(() => ({ ok: false, status: 404, body: { message: 'Not found' } }));
      const status = await new TextBeeSMSProvider().getStatus('device-123:missing');
      expect(status).toBeNull();
    });
  });
});

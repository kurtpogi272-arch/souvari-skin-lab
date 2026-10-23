import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
  env: { SMS_API_KEY: 'semaphore-test-key', SMS_SENDER: 'ApprovedName' },
}));

import { SemaphoreSMSProvider } from './semaphore-sms.provider';

function respond(body: unknown, ok = true) {
  return vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 400, json: async () => body,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SemaphoreSMSProvider', () => {
  it('sends a Philippine number and the configured sender using form encoding', async () => {
    respond([{ message_id: 123, status: 'Queued' }]);
    const result = await new SemaphoreSMSProvider().send('+639932404323', 'Your appointment is cancelled.');
    expect(result).toEqual({ success: true, externalId: 'semaphore:123' });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.semaphore.co/api/v4/messages');
    const body = (options as RequestInit).body as URLSearchParams;
    expect(body.get('sendername')).toBe('ApprovedName');
    expect(body.get('apikey')).toBe('semaphore-test-key');
    expect(body.get('number')).toMatch(/^(\+?63|0)9932404323$/);
  });

  it('rejects validation errors even with HTTP 200', async () => {
    respond({ sendername: ['Sender name is not approved.'] });
    expect((await new SemaphoreSMSProvider().send('+639932404323', 'Hello')).success).toBe(false);
  });

  it.each(['Failed', 'Refunded'])('rejects an immediately %s message', async (status) => {
    respond([{ message_id: 123, status }]);
    expect((await new SemaphoreSMSProvider().send('+639932404323', 'Hello')).success).toBe(false);
  });

  it('does not call the API for an invalid number', async () => {
    respond([]);
    expect((await new SemaphoreSMSProvider().send('invalid', 'Hello')).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['Pending', 'queued'], ['Queued', 'queued'], ['Sent', 'sent'],
    ['Failed', 'failed'], ['Refunded', 'failed'],
  ])('maps %s to %s without inventing handset delivery', async (remote, local) => {
    respond([{ message_id: 123, status: remote }]);
    const result = await new SemaphoreSMSProvider().getStatus('semaphore:123');
    expect(result?.status).toBe(local);
    expect(result?.deliveredAt).toBeUndefined();
  });

  it('does not look up TextBee IDs using Semaphore credentials', async () => {
    respond([]);
    expect(await new SemaphoreSMSProvider().getStatus('device:batch')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a mismatched message returned by a status lookup', async () => {
    respond([{ message_id: 456, status: 'Sent' }]);
    expect(await new SemaphoreSMSProvider().getStatus('semaphore:123')).toBeNull();
  });
});

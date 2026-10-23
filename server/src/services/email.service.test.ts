import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settings, sendMail, createTransport, logError } = vi.hoisted(() => ({
  settings: {
    MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-resend-key',
    MAIL_FROM_EMAIL: 'notifications@example.com', MAIL_FROM_NAME: 'Souvari Skin Lab',
    MAIL_USER: '', MAIL_PASS: '', MAIL_HOST: 'smtp.example.com', MAIL_PORT: 587,
  },
  sendMail: vi.fn(), createTransport: vi.fn(), logError: vi.fn(),
}));
vi.mock('../config/env', () => ({ env: settings }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('../utils/logger', () => ({ default: { error: logError } }));

import { assertEmailConfigured, emailService } from './email.service';

beforeEach(() => {
  vi.clearAllMocks();
  settings.MAIL_PROVIDER = 'resend';
  settings.RESEND_API_KEY = 'test-resend-key';
  settings.MAIL_FROM_EMAIL = 'notifications@example.com';
  settings.MAIL_USER = '';
  settings.MAIL_PASS = '';
  createTransport.mockReturnValue({ sendMail });
  sendMail.mockResolvedValue({ messageId: 'smtp-id', accepted: ['customer@example.com'], rejected: [] });
});
afterEach(() => vi.unstubAllGlobals());

function apiResponse(body: unknown, status = 200) {
  return vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

describe('HTTPS email delivery for Railway', () => {
  it('sends the OTP through Resend HTTPS without SMTP credentials or a phone gateway', async () => {
    apiResponse({ id: 'resend-message-id' });
    await emailService.sendPasswordResetCode('customer@example.com', '123456');
    expect(createTransport).not.toHaveBeenCalled();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(options!.body as string);
    expect(body.to).toEqual(['customer@example.com']);
    expect(body.from).toBe('Souvari Skin Lab <notifications@example.com>');
    expect(body.text).toContain('123456');
    expect(body.text).toContain('expires in 10 minutes');
    expect(options!.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer test-resend-key' }));
    expect(logError).not.toHaveBeenCalled();
  });

  it('selects HTTPS automatically when a Resend key is configured', async () => {
    settings.MAIL_PROVIDER = 'auto';
    apiResponse({ id: 'resend-message-id' });
    await emailService.sendPasswordResetCode('customer@example.com', '123456');
    expect(fetch).toHaveBeenCalledOnce();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it.each([401, 403, 422, 429, 500])('handles provider HTTP %i without logging email contents or credentials', async (status) => {
    apiResponse({ message: 'Sensitive provider response: 123456 test-resend-key customer@example.com' }, status);
    await expect(emailService.sendPasswordResetCode('customer@example.com', '123456')).rejects.toThrow('Email delivery is unavailable');
    expect(logError).toHaveBeenCalledWith('[EMAIL] Resend rejected email', { provider: 'resend', httpStatus: status });
    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).not.toContain('123456');
    expect(logged).not.toContain('test-resend-key');
    expect(logged).not.toContain('customer@example.com');
  });

  it('rejects a success-shaped response without a message ID', async () => {
    apiResponse({});
    await expect(emailService.sendPasswordResetCode('customer@example.com', '123456')).rejects.toThrow('Email delivery is unavailable');
  });

  it('handles network failures without falling back to blocked SMTP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await expect(emailService.sendPasswordResetCode('customer@example.com', '123456')).rejects.toThrow('Email delivery is unavailable');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('requires an API key and configured sender before sending', () => {
    settings.RESEND_API_KEY = '';
    expect(assertEmailConfigured).toThrow('not configured');
    settings.RESEND_API_KEY = 'test-resend-key';
    settings.MAIL_FROM_EMAIL = '';
    expect(assertEmailConfigured).toThrow('not configured');
  });

  it('preserves reply-to and HTML for the contact form', async () => {
    apiResponse({ id: 'contact-message-id' });
    await emailService.sendMail({
      to: 'clinic@example.com', subject: 'Contact message', text: 'Hello', html: '<p>Hello</p>', replyTo: 'customer@example.com',
    });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.reply_to).toBe('customer@example.com');
    expect(body.html).toBe('<p>Hello</p>');
  });

  it('retains SMTP support for environments where it is available', async () => {
    settings.MAIL_PROVIDER = 'smtp';
    settings.MAIL_USER = 'clinic@example.com';
    settings.MAIL_PASS = 'smtp-app-password';
    await emailService.sendPasswordResetCode('customer@example.com', '123456');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'customer@example.com', from: { name: 'Souvari Skin Lab', address: 'notifications@example.com' },
    }));
  });

  it('logs only safe SMTP diagnostics when authentication fails', async () => {
    settings.MAIL_PROVIDER = 'smtp';
    settings.MAIL_USER = 'clinic@example.com';
    settings.MAIL_PASS = 'smtp-app-password';
    sendMail.mockRejectedValue(Object.assign(new Error('smtp-app-password 123456'), { code: 'EAUTH', responseCode: 535 }));
    await expect(emailService.sendPasswordResetCode('customer@example.com', '123456')).rejects.toThrow('Email delivery is unavailable');
    expect(logError).toHaveBeenCalledWith('[EMAIL] SMTP delivery failed', { provider: 'smtp', code: 'EAUTH', responseCode: 535 });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('smtp-app-password');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  users: { findUnique: vi.fn(), update: vi.fn() },
  resets: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  query: vi.fn(), transaction: vi.fn(), sendMail: vi.fn(), transporter: vi.fn(), hashPassword: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  default: {
    users: mocks.users, password_reset_requests: mocks.resets,
    $transaction: mocks.transaction,
  },
}));
vi.mock('../../config/env', () => ({ env: { JWT_ACCESS_SECRET: 'test-otp-hmac-secret' } }));
vi.mock('../../services/email.service', () => ({
  assertEmailConfigured: mocks.transporter,
  emailService: { sendPasswordResetCode: mocks.sendMail },
}));
vi.mock('../../utils/password', () => ({ hashPassword: mocks.hashPassword }));

import { PasswordResetService } from './password-reset.service';
import { forgotPasswordSchema, resetPasswordSchema, verifyResetCodeSchema } from './auth.validation';

const service = new PasswordResetService();
let user: any;
let stored: any;

beforeEach(() => {
  vi.resetAllMocks();
  stored = null;
  user = { id: 1, email: 'customer@example.com', role: 'customer', status: 'active', deleted_at: null, auth_version: 0 };
  mocks.users.findUnique.mockImplementation(async () => user);
  mocks.users.update.mockResolvedValue({});
  mocks.hashPassword.mockResolvedValue('bcrypt-password-hash');
  mocks.resets.findUnique.mockImplementation(async ({ where }) => {
    if (!stored) return null;
    if (where.id && where.id !== stored.id) return null;
    if (where.reset_token_hash && where.reset_token_hash !== stored.reset_token_hash) return null;
    return { ...stored, user };
  });
  mocks.resets.upsert.mockImplementation(async ({ create }) => { stored = { ...create }; return stored; });
  mocks.resets.update.mockImplementation(async ({ data }) => {
    stored = { ...stored, ...data, attempts: data.attempts?.increment ? stored.attempts + data.attempts.increment : stored.attempts };
    return stored;
  });
  mocks.resets.deleteMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (fn) => fn({
    users: mocks.users, password_reset_requests: mocks.resets, $queryRaw: mocks.query,
  }));
});

async function request() {
  await service.requestCode(user.email);
  const code = mocks.sendMail.mock.calls.at(-1)![1] as string;
  return { code, requestId: stored.id };
}

describe('customer email OTP recovery', () => {
  it.each(['staff', 'admin', 'missing', 'inactive', 'deleted'])('does not send a code for %s accounts', async (type) => {
    if (type === 'missing') user = null;
    else if (type === 'deleted') user.deleted_at = new Date();
    else if (type === 'inactive') user.status = 'inactive';
    else user.role = type;
    await expect(service.requestCode('customer@example.com')).rejects.toThrow(
      type === 'inactive' ? 'not active' : 'No customer account found',
    );
    expect(mocks.transporter).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.resets.upsert).not.toHaveBeenCalled();
  });

  it('emails a six-digit code but stores only its keyed hash', async () => {
    const result = await request();
    expect(result.code).toMatch(/^\d{6}$/);
    expect(stored.otp_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.otp_hash).not.toBe(result.code);
    expect(stored.expires_at.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(result).not.toHaveProperty('resetToken');
  });

  it('enforces the resend cooldown without sending a second email', async () => {
    const first = await request();
    const second = await service.requestCode(user.email);
    expect(second.sent).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(stored.id).toBe(first.requestId);
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });

  it('invalidates the previous OTP when a new code is requested', async () => {
    const first = await request();
    stored.last_sent_at = new Date(Date.now() - 61000);
    const second = await request();
    expect(second.requestId).not.toBe(first.requestId);
    if (first.code !== second.code) {
      await expect(service.verifyCode(user.email, first.code)).rejects.toThrow('Invalid or expired');
    }
    await expect(service.verifyCode(user.email, second.code)).resolves.toHaveProperty('resetToken');
  });

  it('commits failed attempts and blocks the correct code after five mistakes', async () => {
    const { code } = await request();
    const wrongCode = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(service.verifyCode(user.email, wrongCode)).rejects.toThrow('Invalid or expired');
    }
    expect(stored.attempts).toBe(5);
    await expect(service.verifyCode(user.email, code)).rejects.toThrow('Invalid or expired');
  });

  it('rejects an expired code', async () => {
    const { code } = await request();
    stored.expires_at = new Date(Date.now() - 1);
    await expect(service.verifyCode(user.email, code)).rejects.toThrow('Invalid or expired');
  });

  it('binds the OTP to the requested email and customer role', async () => {
    const { code } = await request();
    await expect(service.verifyCode('other@example.com', code)).rejects.toThrow('Invalid or expired');
    user.role = 'staff';
    await expect(service.verifyCode(user.email, code)).rejects.toThrow('Invalid or expired');
  });

  it('allows verification only once and stores only a hash of the reset token', async () => {
    const { code } = await request();
    const { resetToken } = await service.verifyCode(user.email, code);
    expect(resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.reset_token_hash).not.toBe(resetToken);
    await expect(service.verifyCode(user.email, code)).rejects.toThrow('Invalid or expired');
  });

  it('changes the password, revokes existing sessions and consumes the token atomically', async () => {
    const { code } = await request();
    const { resetToken } = await service.verifyCode(user.email, code);
    await service.resetPassword(resetToken, 'new-password-123');
    expect(mocks.users.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { password_hash: 'bcrypt-password-hash', auth_version: { increment: 1 } },
    });
    expect(stored.consumed_at).toBeInstanceOf(Date);
    expect(stored.reset_token_hash).toBeNull();
    await expect(service.resetPassword(resetToken, 'another-password')).rejects.toThrow('session expired');
    expect(mocks.users.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired reset session and an arbitrary token', async () => {
    const { code } = await request();
    const { resetToken } = await service.verifyCode(user.email, code);
    stored.expires_at = new Date(Date.now() - 1);
    await expect(service.resetPassword(resetToken, 'new-password')).rejects.toThrow('session expired');
    await expect(service.resetPassword('a'.repeat(64), 'new-password')).rejects.toThrow('session expired');
    expect(mocks.users.update).not.toHaveBeenCalled();
  });

  it('rechecks that the account is still an active customer before changing a password', async () => {
    const { code } = await request();
    const { resetToken } = await service.verifyCode(user.email, code);
    user.role = 'admin';
    await expect(service.resetPassword(resetToken, 'new-password')).rejects.toThrow('session expired');
    expect(mocks.users.update).not.toHaveBeenCalled();
  });

  it('invalidates the request after email delivery fails', async () => {
    mocks.sendMail.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(service.requestCode(user.email)).rejects.toThrow('Unable to send');
    expect(mocks.resets.deleteMany).toHaveBeenCalledWith({ where: { id: stored.id } });
  });

  it('reports success only after the provider accepts an email for an active customer', async () => {
    const result = await service.requestCode(user.email);
    expect(result).toEqual({ sent: true, retryAfterSeconds: 60 });
    expect(mocks.sendMail).toHaveBeenCalledExactlyOnceWith(user.email, expect.stringMatching(/^\d{6}$/));
  });

  it('does not create an OTP request if email delivery is not configured', async () => {
    mocks.transporter.mockImplementation(() => { throw new Error('Email service is not configured'); });
    await expect(service.requestCode(user.email)).rejects.toThrow('not configured');
    expect(mocks.resets.upsert).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});

describe('recovery input validation', () => {
  it('normalizes the email address', () => {
    expect(forgotPasswordSchema.parse({ email: '  CUSTOMER@example.com ' }).email).toBe('customer@example.com');
  });

  it('rejects malformed codes', () => {
    expect(verifyResetCodeSchema.safeParse({ email: 'a@example.com', code: '12345' }).success).toBe(false);
    expect(verifyResetCodeSchema.safeParse({ email: 'a@example.com', code: 'abc123' }).success).toBe(false);
  });

  it('requires matching passwords and enforces bcrypt byte limits', () => {
    const base = { resetToken: 'a'.repeat(64), password: 'new-password', confirmPassword: 'new-password' };
    expect(resetPasswordSchema.safeParse(base).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ ...base, confirmPassword: 'different' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ ...base, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ ...base, password: 'é'.repeat(37), confirmPassword: 'é'.repeat(37) }).success).toBe(false);
  });
});

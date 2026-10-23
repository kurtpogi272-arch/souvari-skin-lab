import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import prisma from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { emailService, getMailTransporter } from '../../services/email.service';
import { hashPassword } from '../../utils/password';
import logger from '../../utils/logger';

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const RESET_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const INVALID_CODE = 'Invalid or expired code. Please request a new code if needed.';

function hashCode(requestId: string, code: string): string {
  // Keyed hashing prevents offline guessing of a six-digit code from a DB dump.
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${requestId}:${code}`).digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class PasswordResetService {
  async requestCode(email: string): Promise<void> {
    // Check availability for every address so configuration failures do not reveal accounts.
    getMailTransporter();
    const requestId = randomBytes(32).toString('hex');
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user || user.role !== 'customer' || user.status !== 'active' || user.deleted_at) {
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Serialize requests for this customer, including requests on multiple app instances.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const currentUser = await tx.users.findUnique({ where: { id: user.id } });
      if (!currentUser || currentUser.email !== email || currentUser.role !== 'customer' ||
        currentUser.status !== 'active' || currentUser.deleted_at) return null;
      const previous = await tx.password_reset_requests.findUnique({ where: { user_id: user.id } });
      const now = new Date();
      if (previous && now.getTime() - previous.last_sent_at.getTime() < RESEND_COOLDOWN_MS) {
        return false;
      }
      const data = {
        id: requestId, otp_hash: hashCode(requestId, code),
        expires_at: new Date(now.getTime() + CODE_LIFETIME_MS), attempts: 0,
        last_sent_at: now, verified_at: null, reset_token_hash: null, consumed_at: null,
      };
      await tx.password_reset_requests.upsert({
        where: { user_id: user.id }, create: { ...data, user_id: user.id }, update: data,
      });
      return true;
    });

    if (result) {
      try {
        await emailService.sendPasswordResetCode(email, code);
      } catch {
        // Never log the code, reset token, SMTP credentials, or complete email payload.
        logger.error('[PASSWORD RESET] Verification email could not be sent');
        await prisma.password_reset_requests.deleteMany({ where: { id: requestId } });
        throw new AppError('Unable to send the verification email. Please try again later.', 503);
      }
    }
  }

  async verifyCode(email: string, code: string): Promise<{ resetToken: string }> {
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user || user.role !== 'customer' || user.status !== 'active' || user.deleted_at) {
      throw new AppError(INVALID_CODE, 400);
    }
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM password_reset_requests WHERE user_id = ${user.id} FOR UPDATE`;
      const request = await tx.password_reset_requests.findUnique({
        where: { user_id: user.id }, include: { user: true },
      });
      if (!request || request.user.email !== email || request.user.role !== 'customer' ||
        request.user.status !== 'active' || request.user.deleted_at || request.consumed_at ||
        request.verified_at || request.expires_at <= new Date() || request.attempts >= MAX_ATTEMPTS) return null;

      const matches = timingSafeEqual(Buffer.from(request.otp_hash, 'hex'), Buffer.from(hashCode(request.id, code), 'hex'));
      if (!matches) {
        // Return rather than throw inside the transaction so failed attempts are committed.
        await tx.password_reset_requests.update({
          where: { id: request.id }, data: { attempts: { increment: 1 } },
        });
        return null;
      }
      const resetToken = randomBytes(32).toString('hex');
      const now = new Date();
      await tx.password_reset_requests.update({
        where: { id: request.id },
        data: {
          verified_at: now, reset_token_hash: hashToken(resetToken),
          expires_at: new Date(now.getTime() + RESET_LIFETIME_MS),
        },
      });
      return { resetToken };
    });
    if (!result) throw new AppError(INVALID_CODE, 400);
    return result;
  }

  async resetPassword(resetToken: string, password: string): Promise<void> {
    const tokenHash = hashToken(resetToken);
    // Avoid expensive password hashing for an arbitrary, invalid token.
    const candidate = await prisma.password_reset_requests.findUnique({ where: { reset_token_hash: tokenHash } });
    if (!candidate || candidate.consumed_at || !candidate.verified_at || candidate.expires_at <= new Date()) {
      throw new AppError('Password reset session expired. Please request a new code.', 400);
    }
    const passwordHash = await hashPassword(password);
    const changed = await prisma.$transaction(async (tx) => {
      // Use the same user->request lock order as resend to avoid deadlocks.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.user_id} FOR UPDATE`;
      const request = await tx.password_reset_requests.findUnique({
        where: { reset_token_hash: tokenHash }, include: { user: true },
      });
      if (!request || !request.verified_at || request.consumed_at || request.expires_at <= new Date() ||
        request.user.role !== 'customer' || request.user.status !== 'active' || request.user.deleted_at) return false;
      await tx.users.update({
        where: { id: request.user_id },
        data: { password_hash: passwordHash, auth_version: { increment: 1 } },
      });
      await tx.password_reset_requests.update({
        where: { id: request.id }, data: { consumed_at: new Date(), reset_token_hash: null },
      });
      return true;
    });
    if (!changed) throw new AppError('Password reset session expired. Please request a new code.', 400);
  }
}

export const passwordResetService = new PasswordResetService();

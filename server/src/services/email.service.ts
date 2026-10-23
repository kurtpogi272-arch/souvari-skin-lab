import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

let transporter: Transporter | null = null;

function emailProvider(): 'smtp' | 'resend' {
  return env.MAIL_PROVIDER === 'auto' ? (env.RESEND_API_KEY ? 'resend' : 'smtp') : env.MAIL_PROVIDER;
}

export function assertEmailConfigured(): void {
  if (emailProvider() === 'resend') {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM_EMAIL) {
      throw new AppError('Email service is not configured. Please contact the clinic.', 503);
    }
  } else if (!env.MAIL_USER || !env.MAIL_PASS) {
    throw new AppError('Email service is not configured. Please contact the clinic.', 503);
  }
}

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export function getMailTransporter(): Transporter {
  if (!env.MAIL_USER || !env.MAIL_PASS) {
    throw new AppError('Email service is not configured. Please contact the clinic.', 503);
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      secure: env.MAIL_PORT === 465,
      auth: { user: env.MAIL_USER, pass: env.MAIL_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

export const emailService = {
  async sendMail(message: EmailMessage): Promise<{ messageId: string }> {
    assertEmailConfigured();
    const provider = emailProvider();
    const sender = env.MAIL_FROM_EMAIL || env.MAIL_USER;
    if (provider === 'resend') {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `${env.MAIL_FROM_NAME} <${sender}>`,
            to: [message.to], subject: message.subject, text: message.text,
            ...(message.html ? { html: message.html } : {}),
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(20000),
        });
        const result: any = await response.json().catch(() => null);
        if (!response.ok || typeof result?.id !== 'string' || !result.id) {
          // Status codes distinguish credentials/sender errors (401/403/422),
          // quotas (429), and outages (5xx), without exposing the email or code.
          logger.error('[EMAIL] Resend rejected email', { provider, httpStatus: response.status });
          throw new AppError('Email delivery is unavailable. Please contact the clinic or try again later.', 503);
        }
        return { messageId: result.id };
      } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error('[EMAIL] Resend HTTPS request failed', { provider });
        throw new AppError('Email delivery is unavailable. Please contact the clinic or try again later.', 503);
      }
    }

    try {
      const result = await getMailTransporter().sendMail({
        ...message,
        from: { name: env.MAIL_FROM_NAME, address: sender },
      });
      if (result.rejected?.length) throw new AppError('The email provider rejected the recipient.', 503);
      return { messageId: result.messageId };
    } catch (error) {
      const failure = error as { code?: string; responseCode?: number };
      const knownCodes = ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'ESOCKET', 'EENVELOPE', 'EMESSAGE'];
      logger.error('[EMAIL] SMTP delivery failed', {
        provider,
        code: knownCodes.includes(failure.code ?? '') ? failure.code : 'UNKNOWN',
        responseCode: typeof failure.responseCode === 'number' ? failure.responseCode : undefined,
      });
      throw new AppError('Email delivery is unavailable. Please contact the clinic or try again later.', 503);
    }
  },

  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    await emailService.sendMail({
      to: email,
      subject: 'Your Souvari Skin Lab password reset code',
      text: [
        'You requested to reset your Souvari Skin Lab customer password.',
        '',
        `Your verification code is: ${code}`,
        '',
        'This code expires in 10 minutes and can only be used once.',
        'Do not share this code with anyone.',
        'If you did not request a password reset, you can ignore this email. Your password has not changed.',
      ].join('\n'),
    });
  },
};

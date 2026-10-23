import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

let transporter: Transporter | null = null;

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
  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    await getMailTransporter().sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_USER },
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

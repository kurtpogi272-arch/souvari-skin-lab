import { assertEmailConfigured, emailService } from '../../services/email.service';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import logger from '../../utils/logger';
import { SendContactMessageInput } from './contact.validation';

class ContactService {
  async sendMessage(data: SendContactMessageInput): Promise<void> {
    if (!env.MAIL_USER) {
      throw new AppError('Email service is not configured', 503);
    }
    assertEmailConfigured();

    // Email to the clinic (inbound contact notification)
    const clinicMail = {
      from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_USER}>`,
      to: env.MAIL_USER,
      replyTo: data.email,
      subject: `New message from ${data.name}`,
      text: [
        `${data.subject}`,
        '',
        data.message,
        '',
        `From: ${data.name} <${data.email}>`,
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <p style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #9ca3af; margin: 0 0 8px;">New Contact Message</p>
          <h2 style="color: #111827; margin: 0 0 16px;">${data.subject}</h2>
          <p style="font-size: 14px; line-height: 1.7; color: #374151; white-space: pre-wrap; margin: 0 0 24px;">${data.message.replace(/\n/g, '<br />')}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0 0 12px;" />
          <p style="font-size: 13px; color: #6b7280; margin: 0;">From: ${data.name} — ${data.email}</p>
        </div>
      `,
    };

    // Email to the customer (professional acknowledgment)
    const customerMail = {
      from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_USER}>`,
      to: data.email,
      replyTo: env.MAIL_USER,
      subject: 'Thank you for contacting Souvari Skin Lab',
      text: [
        `Hi ${data.name},`,
        '',
        'Thank you for reaching out to Souvari Skin Lab. We have received your message and one of our team members will get back to you soon.',
        '',
        `Subject: ${data.subject}`,
        data.message,
        '',
        'Souvari Skin Lab',
        `${env.MAIL_USER}`,
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="color: #111827; margin-top: 0;">Hi ${data.name},</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #374151; margin: 0 0 24px;">Thank you for reaching out to Souvari Skin Lab. We have received your message and one of our team members will get back to you soon.</p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <p style="font-size: 13px; color: #6b7280; margin: 0 0 4px;"><strong>Subject</strong></p>
            <p style="font-size: 14px; color: #111827; margin: 0 0 16px;">${data.subject}</p>
            <p style="font-size: 13px; color: #6b7280; margin: 0 0 4px;"><strong>Message</strong></p>
            <p style="font-size: 14px; line-height: 1.6; color: #374151; white-space: pre-wrap; margin: 0;">${data.message.replace(/\n/g, '<br />')}</p>
          </div>
          <p style="font-size: 13px; color: #6b7280; margin: 0;">Souvari Skin Lab</p>
          <p style="font-size: 12px; color: #9ca3af; margin: 4px 0 0;">${env.MAIL_USER}</p>
        </div>
      `,
    };

    try {
      const [clinicInfo, customerInfo] = await Promise.all([
        emailService.sendMail(clinicMail),
        emailService.sendMail(customerMail),
      ]);
      logger.info(`Contact email sent to clinic ${env.MAIL_USER} (${clinicInfo.messageId}) and customer ${data.email} (${customerInfo.messageId})`);
    } catch (error) {
      logger.error('Failed to send contact email:', { error: (error as Error).message });
      if ((error as Error).message.includes('Application-specific password')) {
        throw new AppError('Email service authentication failed. Please set a valid app password.', 503);
      }
      throw new AppError('Failed to send message. Please try again later.', 500);
    }
  }
}

export const contactService = new ContactService();

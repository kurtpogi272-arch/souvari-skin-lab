import app from './app';
import { env } from './config/env';
import prisma from './config/database';
import logger from './utils/logger';
import { membershipService } from './modules/memberships/memberships.service';
import { appointmentService } from './modules/appointments/appointments.service';
import { smsDeliveryTrackerService } from './services/sms-delivery-tracker.service';

const OVERDUE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SMS_TRACKER_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function runOverdueCheck() {
  try {
    const { reminded, failed } = await membershipService.processOverdueMemberships(true);
    if (reminded > 0 || failed > 0) {
      logger.info(`[MEMBERSHIP] Overdue check: ${failed} failed, ${reminded} reminders sent`);
    }
  } catch (error: any) {
    logger.error(`[MEMBERSHIP] Overdue check failed: ${error.message}`);
  }
}

// Follows up on recently accepted SMS to record whether they were delivered.
async function runSmsDeliveryCheck() {
  try {
    await smsDeliveryTrackerService.reconcileRecent();
  } catch (error: any) {
    logger.error(`[SMS TRACKER] Reconcile failed: ${error.message}`);
  }
}

// Runs the daily appointment-reminder batch at the configured local hour.
async function runReminderCheck() {
  if (!env.REMINDERS_ENABLED) return;
  if (new Date().getHours() !== env.REMINDER_RUN_HOUR) return;
  try {
    const { reminded, failed } = await appointmentService.processAppointmentReminders();
    if (reminded > 0 || failed > 0) {
      logger.info(`[REMINDER] Batch complete: ${reminded} reminded, ${failed} failed`);
    }
  } catch (error: any) {
    logger.error(`[REMINDER] Batch failed: ${error.message}`);
  }
}

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');

    const server = app.listen(env.PORT, () => {
      logger.info(`Souvari Skin Lab API server running on port ${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`Frontend URL: ${env.FRONTEND_URL}`);
      void runOverdueCheck();
      setInterval(() => { void runOverdueCheck(); }, OVERDUE_CHECK_INTERVAL_MS);
      void runReminderCheck();
      setInterval(() => { void runReminderCheck(); }, REMINDER_CHECK_INTERVAL_MS);
      void runSmsDeliveryCheck();
      setInterval(() => { void runSmsDeliveryCheck(); }, SMS_TRACKER_INTERVAL_MS);
    });

    // Keep process alive for the overdue scheduler even if the HTTP server errors.
    server.on('error', (err) => {
      logger.error('HTTP server error:', err);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

main();

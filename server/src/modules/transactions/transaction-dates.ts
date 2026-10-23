import { Prisma } from '@prisma/client';
import { clinicDayStartUtc, clinicDayEndUtc, toLocalDayKey } from './transactions-report-math';

/** Shared reporting date: appointment/visit day, otherwise the POS record time. */
export function transactionReportDate(transaction: {
  created_at: Date;
  appointment?: { appointment_date: Date } | null;
}): Date {
  return transaction.appointment?.appointment_date ?? transaction.created_at;
}

/**
 * Keep the date OR inside its own AND so customer/reference searches cannot
 * accidentally widen the reporting period. Calendar bounds are always UTC+8.
 */
export function transactionDateFilter(dateFrom?: string, dateTo?: string): Prisma.transactionsWhereInput {
  const bounds: Prisma.DateTimeFilter = {};
  const from = dateFrom ? clinicDayStartUtc(dateFrom) : null;
  const to = dateTo ? clinicDayEndUtc(dateTo) : null;
  if (from) bounds.gte = from;
  if (to) bounds.lte = to;
  if (!from && !to) return {};

  return {
    AND: [{ OR: [
      { appointment: { appointment_date: bounds } },
      { appointment_id: null, created_at: bounds },
    ] }],
  };
}

export function clinicMonthRange(now = new Date()): { from: string; to: string } {
  const today = toLocalDayKey(now);
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${lastDay}` };
}

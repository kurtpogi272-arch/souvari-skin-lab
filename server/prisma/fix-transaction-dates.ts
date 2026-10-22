import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Aligns appointment-linked transactions with the visit date.
 *
 * Seeded/imported records were created with `created_at = now()` (the import
 * time) while `paid_at` was set to the appointment date, so a transactions
 * report filtered by date filed them under the wrong month. This sets both
 * timestamps to the appointment's date, keeping the exact time-of-day that was
 * already on the record where possible.
 */
async function main() {
  const transactions = await prisma.transactions.findMany({
    where: { appointment_id: { not: null }, deleted_at: null },
    select: { id: true, created_at: true, paid_at: true, appointment_id: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const txn of transactions) {
    const appt = await prisma.appointments.findUnique({
      where: { id: txn.appointment_id as number },
      select: { appointment_date: true },
    });
    if (!appt) {
      skipped++;
      continue;
    }

    const apptDay = appt.appointment_date;
    const sameDay = (a: Date | null, b: Date) =>
      a !== null && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

    if (sameDay(txn.created_at, apptDay) && sameDay(txn.paid_at, apptDay)) {
      skipped++;
      continue;
    }

    const withDay = (base: Date | null) => {
      const time = base ?? txn.created_at;
      return new Date(
        Date.UTC(
          apptDay.getUTCFullYear(),
          apptDay.getUTCMonth(),
          apptDay.getUTCDate(),
          time.getUTCHours(),
          time.getUTCMinutes(),
          time.getUTCSeconds(),
          time.getUTCMilliseconds()
        )
      );
    };

    await prisma.transactions.update({
      where: { id: txn.id },
      data: {
        created_at: withDay(txn.created_at),
        paid_at: txn.paid_at ? withDay(txn.paid_at) : null,
      },
    });
    updated++;
  }

  console.log(
    `Transaction date backfill complete: ${updated} updated, ${skipped} skipped, ${transactions.length} appointment-linked transactions total.`
  );
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { z } from 'zod';
import { walkInCustomerSchema } from '../customers/customers.validation';

const appointmentStatusEnum = z.enum([
  'pending',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
]);

/** Canonical lowercase weekday names, Monday-first for display ordering. */
export const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export const createAppointmentSchema = z.object({
  customer_id: z.number().int().positive('Customer ID is required'),
  staff_id: z.number().int().positive('Staff ID is required').optional(),
  service_id: z.number().int().positive('Service ID is required'),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Start time must be in HH:MM format'),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'End time must be in HH:MM format').optional(),
  membership_code: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Manual staff discount, as a percentage of the post-membership/perk quote.
 * Coerced so the booking drawer can send the chip value straight through, and
 * bounded to 0–100 so a client can never inflate the credit beyond the total.
 */
const manualDiscountPct = z.coerce.number().min(0).max(100).optional();

/** Why the discount was granted. Capped to match the column width. */
const manualDiscountReason = z.string().trim().max(255).nullable().optional();

export const createGroupAppointmentSchema = z
  .object({
    customer_id: z.number().int().positive('Customer ID is required').optional(),
    walk_in: walkInCustomerSchema.optional(),
    staff_id: z.number().int().positive('Staff ID is required').optional(),
    service_ids: z.array(z.number().int().positive('Service ID is required')).min(1, 'At least one service is required'),
    appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Start time must be in HH:MM format'),
    membership_code: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
    // Accepted at the top level too, so a discount can be recorded on a
    // booking saved without payment (the Save button sends no `payment`).
    discount_pct: manualDiscountPct,
    discount_reason: manualDiscountReason,
    payment: z
      .object({
        payment_method: z.enum(['cash', 'gcash', 'gotyme', 'rcbc', 'paid_on_us']),
        amount_tendered: z.number().nonnegative().optional(),
        discount_pct: manualDiscountPct,
        discount_reason: manualDiscountReason,
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    const hasCustomerId = val.customer_id !== undefined;
    const hasWalkIn = val.walk_in !== undefined;
    if (hasCustomerId === hasWalkIn) {
      ctx.addIssue({
        code: 'custom',
        path: ['customer_id'],
        message: 'Provide either a customer_id or walk_in client information',
      });
    }

    // A discount needs a reason for the audit trail. The reason can ride on
    // the payment block or at the top level for a no-payment save.
    const pct = val.payment?.discount_pct ?? val.discount_pct;
    const reason = val.payment?.discount_reason ?? val.discount_reason;
    if (pct !== undefined && pct > 0 && !reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['payment', 'discount_reason'],
        message: 'Please provide a reason for the discount',
      });
    }
  });

export const updateAppointmentSchema = z.object({
  staff_id: z.number().int().positive().optional(),
  service_id: z.number().int().positive().optional(),
  // Full replacement of the appointment's service list. Replaces
  // `service_id` when the booking already holds multiple services, and
  // drives the derived `end_time` + re-pricing in the service layer.
  service_ids: z.array(z.number().int().positive()).min(1, 'At least one service is required').optional(),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  status: appointmentStatusEnum.optional(),
  cancellation_reason: z.string().nullable().optional(),
  reschedule_reason: z.string().nullable().optional(),
  membership_code: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  // Manual staff discount on the current quote. Re-applied whenever the quote
  // is recomputed (e.g. services added), so the balance due stays consistent.
  discount_pct: manualDiscountPct,
  discount_reason: manualDiscountReason,
});

export const listAppointmentsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  customer_id: z.coerce.number().int().positive().optional(),
  staff_id: z.coerce.number().int().positive().optional(),
  service_id: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
  // A single calendar day (YYYY-MM-DD), a convenience alias for a one-day
  // date_from/date_to range. The list service expands it to both bounds.
  date: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  sort_by: z.enum(['appointment_date', 'created_at', 'start_time']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
});

export const appointmentIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateStatusSchema = z.object({
  status: appointmentStatusEnum,
  reason: z.string().nullable().optional(),
});

export const operatingDaysImpactQuerySchema = z.object({
  days: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    )
    .pipe(z.array(z.enum(WEEKDAY_NAMES)).min(1, 'At least one day is required')),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type CreateGroupAppointmentInput = z.infer<typeof createGroupAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type OperatingDaysImpactQuery = z.infer<typeof operatingDaysImpactQuerySchema>;

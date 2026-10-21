import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import pricingService from '../../services/pricing.service';
import { notificationDispatch } from '../../services/notification-dispatch.service';
import { customerService } from '../customers/customers.service';
import { getPaginationParams, createPaginatedResult, PaginatedResult } from '../../utils/pagination';
import logger from '../../utils/logger';
import {
  CreateAppointmentInput,
  CreateGroupAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsQuery,
  WeekdayName,
} from './appointments.validation';
import { summarizeAppointmentPayment } from './payment-summary';

/**
 * Columns every read path needs to work out what is still owed. `items` is
 * included so a balance collection can tell which services have already been
 * billed and must not be charged twice.
 */
const PAYMENT_ROW_SELECT = {
  type: true,
  payment_status: true,
  total_amount: true,
  items: { select: { service_id: true } },
} as const;

/** Who is performing an update. Drives the permissions the service enforces. */
export interface AppointmentActor {
  role?: 'admin' | 'staff' | 'customer';
  userId?: number;
}

/** Statuses a customer is still allowed to cancel from. */
const CUSTOMER_CANCELLABLE_STATUSES = ['pending', 'confirmed'];

/** Default audit-trail reason recorded when a customer cancels their own booking. */
const CUSTOMER_CANCEL_REASON = 'Cancelled by customer';

/**
 * Statuses that describe what is happening *in the clinic* on the day of the
 * visit. They cannot be set before the appointment's date arrives.
 */
const STATUS_REQUIRES_TODAY = ['checked_in', 'in_progress', 'completed'];

/**
 * Weekday names indexed directly by JS `Date.getDay()` (0 = Sunday), so a date
 * read out of the DB can be resolved with no arithmetic.
 */
const WEEKDAY_NAMES_BY_JS: WeekdayName[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Result of resolving + pricing a replacement service list. */
interface ServiceChangePlan {
  serviceIds: number[];
  serviceNames: string[];
  endTime: string;
  quotedPrice: number;
  priceType: string | null;
  lines: Array<{ service_id: number; unit_price: number; duration_minutes: number }>;
  addedServiceNames: string[];
  changed: boolean;
}

export class AppointmentService {
  async quote(serviceId: number, customerId?: number, membershipCode?: string) {
    const pricing = await pricingService.calculatePrice(
      { serviceId, membershipCode },
      customerId
    );
    return pricing;
  }

  async list(query: ListAppointmentsQuery): Promise<PaginatedResult<any>> {
    const { page, limit, skip } = getPaginationParams(query);
    const { customer_id, staff_id, service_id, status, date, date_from, date_to, sort_by, sort_order } = query;

    const where: any = { deleted_at: null };

    if (customer_id) where.customer_id = customer_id;
    if (staff_id) where.staff_id = staff_id;
    if (service_id) where.service_id = service_id;
    if (status) {
      const statuses = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }

    // `date` is a convenience alias for a single day; expand it to the same
    // inclusive range a date_from/date_to pair would produce. Without this a
    // caller asking for "today" silently received every day's appointments.
    const rangeFrom = date_from ?? date;
    const rangeTo = date_to ?? date;
    if (rangeFrom || rangeTo) {
      where.appointment_date = {};
      if (rangeFrom) where.appointment_date.gte = new Date(rangeFrom);
      if (rangeTo) {
        const endDate = new Date(rangeTo);
        endDate.setHours(23, 59, 59, 999);
        where.appointment_date.lte = endDate;
      }
    }

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order || 'desc';
    } else {
      orderBy.appointment_date = 'desc';
    }

    const [appointments, total] = await Promise.all([
      prisma.appointments.findMany({
        where,
        include: {
          customer: {
            select: { id: true, first_name: true, last_name: true },
          },
          staff: {
            select: { id: true, first_name: true, last_name: true, position: true },
          },
          service: {
            select: { id: true, name: true, price: true, duration_minutes: true },
          },
          services: {
            include: {
              service: { select: { id: true, name: true, price: true, duration_minutes: true } },
            },
            orderBy: { id: 'asc' },
          },
          transactions: { select: PAYMENT_ROW_SELECT },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.appointments.count({ where }),
    ]);

    return createPaginatedResult(
      appointments.map((a) => this.withServices(a)),
      total,
      { page, limit, skip }
    );
  }

  private withServices(a: any): any {
    const { services, transactions, appointment_date, ...rest } = a;
    const mapped = (services ?? []).map((as: any) => ({
      id: as.service_id,
      name: as.service.name,
      price: as.unit_price !== null && as.unit_price !== undefined ? Number(as.unit_price) : Number(as.service.price),
      duration_minutes: as.duration_minutes ?? as.service.duration_minutes,
    }));

    const payment = summarizeAppointmentPayment({
      quotedPrice: a.quoted_price,
      discountPct: a.discount_pct,
      transactions,
    });

    return {
      ...rest,
      appointment_date,
      date: appointment_date,
      services: mapped,
      // `paid` is kept so existing consumers keep working, but it now means
      // "nothing outstanding" rather than "at least one paid row exists".
      paid: payment.balance <= 0,
      discount_pct: payment.discount_pct || null,
      amount_due: payment.amount_due,
      paid_amount: payment.paid_amount,
      balance: payment.balance,
    };
  }

  async getById(id: number) {
    const appointment = await prisma.appointments.findFirst({
      where: { id, deleted_at: null },
      include: {
        customer: {
          select: { id: true, first_name: true, last_name: true },
        },
        staff: {
          select: { id: true, first_name: true, last_name: true, position: true },
        },
        service: {
          select: { id: true, name: true, price: true, duration_minutes: true },
        },
        services: {
          include: {
            service: { select: { id: true, name: true, price: true, duration_minutes: true } },
          },
          orderBy: { id: 'asc' },
        },
        transactions: { select: PAYMENT_ROW_SELECT },
        status_history: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        treatment_record: {
          select: { id: true, notes: true },
        },
      },
    });

    if (!appointment) {
      throw new AppError('Appointment not found', 404);
    }

    return this.withServices(appointment);
  }

  /**
   * Balance due on an appointment, itemised by service.
   *
   * Used when a booking was edited to add a service after it had already been
   * paid for. Only the services no prior transaction has covered are returned,
   * so completing the booking cannot re-charge a service that was already
   * billed — and inventory is only consumed once per service, because
   * `createTransaction` decrements stock from the item list.
   *
   * `uncovered` is priced from `appointment_services.unit_price` (the quoted,
   * membership-aware price) rather than re-quoted, so it always reconciles with
   * the appointment total the staff member already saw.
   */
  async getBalance(id: number) {
    const appointment = await prisma.appointments.findFirst({
      where: { id, deleted_at: null },
      select: {
        id: true,
        customer_id: true,
        staff_id: true,
        appointment_date: true,
        status: true,
        quoted_price: true,
        discount_pct: true,
        discount_reason: true,
        services: {
          select: {
            service_id: true,
            unit_price: true,
            service: { select: { id: true, name: true, price: true } },
          },
          orderBy: { id: 'asc' },
        },
        transactions: { select: PAYMENT_ROW_SELECT },
      },
    });

    if (!appointment) {
      throw new AppError('Appointment not found', 404);
    }

    const payment = summarizeAppointmentPayment({
      quotedPrice: appointment.quoted_price,
      discountPct: appointment.discount_pct,
      transactions: appointment.transactions,
    });

    const covered = new Set(payment.covered_service_ids);

    const describe = (row: any, alreadyCovered: boolean) => ({
      service_id: row.service_id,
      name: row.service.name,
      price:
        row.unit_price !== null && row.unit_price !== undefined
          ? Number(row.unit_price)
          : Number(row.service.price),
      already_covered: alreadyCovered,
    });

    const uncovered = appointment.services.filter((row) => !covered.has(row.service_id)).map((row) => describe(row, false));
    const coveredServices = appointment.services.filter((row) => covered.has(row.service_id)).map((row) => describe(row, true));

    // Split the balance across the uncovered lines in proportion to their
    // price, pushing the rounding remainder onto the last line so the lines
    // always sum to exactly `balance`. Pricing each line off the discount
    // percentage alone would not, because the transaction side covers whole
    // services at once; allocating proportionally keeps the arithmetic sound
    // for any split of paid and unpaid services.
    const uncoveredBase = uncovered.reduce((sum, line) => sum + line.price, 0);
    let allocatedSoFar = 0;
    const lineItems = uncovered.map((line, index) => {
      const isLast = index === uncovered.length - 1;
      const lineTotal = isLast
        ? Math.round((payment.balance - allocatedSoFar) * 100) / 100
        : Math.round((uncoveredBase > 0 ? (line.price / uncoveredBase) * payment.balance : payment.balance) * 100) / 100;
      allocatedSoFar += lineTotal;
      return { ...line, line_total: lineTotal };
    });

    return {
      appointment_id: appointment.id,
      status: appointment.status,
      quoted_total: appointment.quoted_price === null ? 0 : Number(appointment.quoted_price),
      discount_pct: payment.discount_pct,
      discount_reason: appointment.discount_reason,
      amount_due: payment.amount_due,
      paid_amount: payment.paid_amount,
      balance: payment.balance,
      covered_services: coveredServices,
      uncovered_services: lineItems,
      has_balance: payment.balance > 0,
    };
  }

  async create(data: CreateAppointmentInput) {
    const customer = await prisma.customers.findFirst({
      where: { id: data.customer_id, deleted_at: null },
    });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const service = await prisma.services.findFirst({
      where: { id: data.service_id, deleted_at: null },
    });
    if (!service) {
      throw new AppError('Service not found', 404);
    }

    // Clinic-wide operating days gate: reject bookings on days the clinic is
    // closed, mirroring the getAvailability closed-day handling.
    const closedWeekdays = await this.getClosedWeekdays();
    if (closedWeekdays.has(this.weekdayOf(data.appointment_date))) {
      throw new AppError(
        'The clinic is closed on this day. Please choose an operating day.',
        422
      );
    }

    // Past-date gate: bookings must be for a current or future date.
    if (data.appointment_date < this.localDateString()) {
      throw new AppError(
        'Cannot book an appointment in the past. Please choose a current or future date.',
        422
      );
    }

    // Same-day past-time gate: the start time must still be in the future.
    if (data.appointment_date === this.localDateString() && data.start_time <= this.localTimeString()) {
      throw new AppError(
        'Cannot book an appointment at a time that has already passed. Please choose a later time.',
        422
      );
    }

    let endTime = data.end_time;
    if (!endTime) {
      const [hours, minutes] = data.start_time.split(':').map(Number);
      const totalMinutes = hours * 60 + minutes + service.duration_minutes;
      const endHours = Math.floor(totalMinutes / 60);
      const endMins = totalMinutes % 60;
      endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
    }

    // Store-hours gate: the booking window must fit inside the clinic's public
    // opening hours, not merely the specialist's shift.
    await this.assertWithinBusinessHours(data.start_time, endTime);

    // Resolve the staff member. Every booking must explicitly select the
    // specialist who will perform the service.
    const staff = await this.resolveStaff(
      data.staff_id,
      data.appointment_date,
      data.start_time,
      endTime
    );

    let quotedPrice: number | null = null;
    let priceType: string | null = null;
    try {
      const pricing = await pricingService.calculatePrice(
        {
          serviceId: data.service_id,
          membershipCode: data.membership_code ?? undefined,
        },
        data.customer_id
      );
      quotedPrice = pricing.finalTotal;
      priceType = pricing.priceType;
    } catch {
      quotedPrice = null;
      priceType = null;
    }

    const appointment = await prisma.appointments.create({
      data: {
        customer_id: data.customer_id,
        staff_id: staff.id,
        service_id: data.service_id,
        appointment_date: new Date(data.appointment_date),
        start_time: data.start_time,
        end_time: endTime,
        quoted_price: quotedPrice,
        price_type: priceType,
        membership_code: data.membership_code ?? null,
        notes: data.notes ?? null,
      },
      include: {
        customer: {
          select: { id: true, first_name: true, last_name: true },
        },
        staff: {
          select: { id: true, first_name: true, last_name: true, position: true, user_id: true },
        },
        service: {
          select: { id: true, name: true, price: true, duration_minutes: true },
        },
      },
    });

    // Dispatch notifications for new booking
    try {
      const customerUser = await prisma.users.findUnique({
        where: { id: customer.user_id },
        select: { id: true, phone: true },
      });
      const adminUserIds = await notificationDispatch.getAdminUserIds();

      await notificationDispatch.dispatchNewBooking({
        appointmentId: appointment.id,
        customerUserId: customer.user_id,
        customerName: `${customer.first_name} ${customer.last_name}`,
        customerPhone: customerUser?.phone ?? null,
        staffUserId: staff.user_id,
        staffName: `${staff.first_name} ${staff.last_name}`,
        serviceName: service.name,
        appointmentDate: data.appointment_date,
        appointmentTime: data.start_time,
        quotedPrice: quotedPrice,
        status: 'pending',
        adminUserIds,
      });
    } catch (err: any) {
      logger.error(`[APPOINTMENT] New-booking notification failed: ${err?.message ?? err}`);
    }

    return appointment;
  }

  async createGroup(data: CreateGroupAppointmentInput, callerRole?: string) {
    const services = await prisma.services.findMany({
      where: { id: { in: data.service_ids }, deleted_at: null },
    });
    if (services.length !== data.service_ids.length) {
      throw new AppError('One or more services not found', 404);
    }
    // Preserve the requested selection order
    const orderedServices = data.service_ids
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);

    const totalDuration = orderedServices.reduce((sum, s) => sum + s.duration_minutes, 0);

    // Clinic-wide operating days gate
    const closedWeekdays = await this.getClosedWeekdays();
    if (closedWeekdays.has(this.weekdayOf(data.appointment_date))) {
      throw new AppError(
        'The clinic is closed on this day. Please choose an operating day.',
        422
      );
    }

    // Past-date gate: bookings must be for a current or future date.
    if (data.appointment_date < this.localDateString()) {
      throw new AppError(
        'Cannot book an appointment in the past. Please choose a current or future date.',
        422
      );
    }

    // Same-day past-time gate: the start time must still be in the future.
    if (data.appointment_date === this.localDateString() && data.start_time <= this.localTimeString()) {
      throw new AppError(
        'Cannot book an appointment at a time that has already passed. Please choose a later time.',
        422
      );
    }

    // Resolve the client: an existing customer by id, or a new customer record
    // for a walk-in. Walk-in customers are created only after the services and
    // operating-day checks pass, so invalid bookings do not leave orphan rows.
    let customer: any;
    let customerId: number;
    if (data.walk_in) {
      customer = await customerService.createWalkIn(data.walk_in);
      customerId = customer.id;
    } else {
      customer = await prisma.customers.findFirst({
        where: { id: data.customer_id, deleted_at: null },
      });
      if (!customer) {
        throw new AppError('Customer not found', 404);
      }
      customerId = customer.id;
    }

    // Combined block [start_time, end_time] spanning all services
    const [startHours, startMins] = data.start_time.split(':').map(Number);
    const startTotal = startHours * 60 + startMins;
    const endTotal = startTotal + totalDuration;
    const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;

    // Store-hours gate: the whole multi-service block must fit inside the
    // clinic's public opening hours.
    await this.assertWithinBusinessHours(data.start_time, endTime);

    // Resolve the single specialist who handles the whole block
    const staff = await this.resolveStaff(data.staff_id, data.appointment_date, data.start_time, endTime);

    // Per-service pricing (member/perk aware) for the combined quoted price
    const pricingList: Array<any> = [];
    let quotedPrice = 0;
    let primaryPriceType: string | null = null;
    for (const svc of orderedServices) {
      try {
        const pricing = await pricingService.calculatePrice(
          { serviceId: svc.id, membershipCode: data.membership_code ?? undefined },
          customerId
        );
        pricingList.push(pricing);
        quotedPrice += pricing.finalTotal;
        if (!primaryPriceType) primaryPriceType = pricing.priceType;
      } catch {
        pricingList.push(null);
      }
    }

    // No discount is recorded at booking time. Admin/staff bookings are pure
    // scheduling acts, like the customer flow; payment and any discount happen
    // together in the POS modal when the booking is marked complete, and the
    // transaction path persists the discount back onto the appointment then.
    // Staff/admin bookings are considered confirmed (the staff member entered
    // them in person); self-service customer bookings stay `pending` awaiting
    // clinic confirmation.

    // ONE appointment holding all services
    const appointment = await prisma.appointments.create({
      data: {
        customer_id: customerId,
        staff_id: staff.id,
        service_id: orderedServices[0].id,
        appointment_date: new Date(data.appointment_date),
        start_time: data.start_time,
        end_time: endTime,
        quoted_price: Math.round(quotedPrice * 100) / 100 || null,
        price_type: primaryPriceType,
        membership_code: data.membership_code ?? null,
        status: callerRole === 'customer' ? 'pending' : 'confirmed',
        notes: data.notes ?? null,
        services: {
          create: orderedServices.map((svc, i) => ({
            service_id: svc.id,
            unit_price: pricingList[i] ? pricingList[i].applicablePrice : svc.price,
            duration_minutes: svc.duration_minutes,
          })),
        },
      },
      include: {
        customer: { select: { id: true, first_name: true, last_name: true } },
        staff: { select: { id: true, first_name: true, last_name: true, position: true, user_id: true } },
        service: { select: { id: true, name: true, price: true, duration_minutes: true } },
        services: {
          include: { service: { select: { id: true, name: true, price: true, duration_minutes: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    // Dispatch notifications for new booking
    try {
      const customerUser = await prisma.users.findUnique({
        where: { id: customer.user_id },
        select: { id: true, phone: true },
      });
      const adminUserIds = await notificationDispatch.getAdminUserIds();

      await notificationDispatch.dispatchNewBooking({
        appointmentId: appointment.id,
        customerUserId: customer.user_id,
        customerName: `${customer.first_name} ${customer.last_name}`,
        customerPhone: customerUser?.phone ?? null,
        staffUserId: staff.user_id,
        staffName: `${staff.first_name} ${staff.last_name}`,
        serviceName: orderedServices.map((s) => s.name).join(', '),
        appointmentDate: data.appointment_date,
        appointmentTime: data.start_time,
        quotedPrice: Math.round(quotedPrice * 100) / 100 || null,
        status: callerRole === 'customer' ? 'pending' : 'confirmed',
        adminUserIds,
      });
    } catch (err: any) {
      logger.error(`[APPOINTMENT] Group-booking notification failed: ${err?.message ?? err}`);
    }

    const result = appointment;

    return {
      appointment: this.withServices(result ?? appointment),
      totalDuration,
      start_time: data.start_time,
      end_time: endTime,
    };
  }

  // ─── Staff resolution ───────────────────────────────────────────────
  // Validates the explicitly selected specialist: must exist, must have no
  // conflicting appointment over the booking window.
  private async resolveStaff(
    staffId: number | undefined,
    appointmentDate: string,
    startTime: string,
    endTime: string
  ): Promise<any> {
    if (!staffId) {
      throw new AppError('Please choose a specialist for this appointment', 400);
    }

    const staff = await prisma.staff.findFirst({
      where: { id: staffId, deleted_at: null },
    });
    if (!staff) {
      throw new AppError('Staff member not found', 404);
    }

    // Store-hours and staff-shift checks run *before* the conflict scan so an
    // out-of-hours request reports the real reason instead of a misleading
    // "already booked" conflict. Mirrors getAvailability.
    await this.assertWithinBusinessHours(startTime, endTime);
    await this.assertStaffWorkable(staffId, appointmentDate, startTime, endTime);

    const conflicts = await prisma.appointments.findMany({
      where: {
        staff_id: staff.id,
        appointment_date: new Date(appointmentDate),
        status: { notIn: ['cancelled', 'no_show'] },
        deleted_at: null,
        OR: [{ start_time: { lt: endTime }, end_time: { gt: startTime } }],
      },
      select: { id: true },
    });
    if (conflicts.length > 0) {
      throw new AppError('Staff member already has an appointment during this time slot', 409);
    }

    return staff;
  }

  // Validates that a specialist is actually scheduled to work during the given
  // window on the given date. Mirrors getAvailability's per-staff rules: no
  // schedule row for the weekday, an inactive schedule, or an explicit off-day
  // (00:00-00:00) all mean the specialist is unavailable. Used by both the
  // create path (resolveStaff) and the update/reschedule path.
  private async assertStaffWorkable(
    staffId: number,
    appointmentDate: string,
    startTime: string,
    endTime: string
  ): Promise<void> {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    const weekday = weekdays[new Date(`${appointmentDate}T00:00:00`).getDay()];
    const schedule = await prisma.staff_schedules.findFirst({
      where: { staff_id: staffId, day_of_week: weekday },
    });

    const isOffDay =
      !schedule ||
      !schedule.is_active ||
      (schedule.start_time === '00:00' && schedule.end_time === '00:00');
    if (isOffDay) {
      throw new AppError(
        'This specialist is not scheduled to work on the selected date.',
        422
      );
    }

    const windowStartMin = this.timeToMinutes(startTime);
    const windowEndMin = this.timeToMinutes(endTime);
    const shiftStartMin = this.timeToMinutes(schedule.start_time);
    const shiftEndMin = this.timeToMinutes(schedule.end_time);
    if (windowStartMin < shiftStartMin || windowEndMin > shiftEndMin) {
      throw new AppError(
        "The requested time falls outside this specialist's working hours for the selected date.",
        422
      );
    }
    if (schedule.break_start && schedule.break_end) {
      const bStart = this.timeToMinutes(schedule.break_start);
      const bEnd = this.timeToMinutes(schedule.break_end);
      if (windowStartMin < bEnd && windowEndMin > bStart) {
        throw new AppError(
          "The requested time overlaps this specialist's break on the selected date.",
          422
        );
      }
    }
  }

  async update(id: number, data: UpdateAppointmentInput, context?: AppointmentActor) {
    const existing = await prisma.appointments.findFirst({
      where: { id, deleted_at: null },
    });

    if (!existing) {
      throw new AppError('Appointment not found', 404);
    }

    // Completed appointments are terminal and immutable — for every role,
    // including admins. No field edits and no status transitions.
    if (existing.status === 'completed') {
      throw new AppError(
        'Completed appointments can no longer be edited or have their status changed.',
        422
      );
    }

    // Cancelled appointments are terminal and immutable — no field edits or
    // status transitions.
    if (existing.status === 'cancelled') {
      throw new AppError(
        'Cancelled appointments can no longer be edited or have their status changed.',
        422
      );
    }

    const isCustomerSelfService = context?.role === 'customer';

    // Check-in and the steps that follow it only make sense on the day of the
    // visit. Without this, a booking dated tomorrow could be marked arrived
    // today. `appointment_date` is a DATE column, so compare like-for-like
    // against the clinic's local date.
    if (
      data.status !== undefined &&
      data.status !== existing.status &&
      STATUS_REQUIRES_TODAY.includes(data.status) &&
      this.dateStringOf(existing.appointment_date) > this.localDateString()
    ) {
      throw new AppError(
        'This appointment is scheduled for a future date and cannot be updated yet.',
        422
      );
    }

    // A customer may only cancel their own appointment, and only while it is
    // still cancellable. Enforced here so it cannot be bypassed by calling the
    // endpoint directly with a different status value.
    if (isCustomerSelfService) {
      if (data.status !== 'cancelled') {
        throw new AppError('Customers can only cancel their appointments', 403);
      }
      if (!CUSTOMER_CANCELLABLE_STATUSES.includes(existing.status)) {
        throw new AppError(
          'This appointment can no longer be cancelled. Please contact the clinic.',
          422
        );
      }
    }

    // Resolve the replacement service list up front. It determines the new
    // block length, which must feed the conflict check below — otherwise a
    // lengthening edit would validate against the *old* end_time and could
    // silently overlap a neighbouring booking.
    const servicePlan =
      data.service_ids !== undefined
        ? await this.planServiceChange(existing, data.service_ids, data.start_time)
        : null;

    // Validate the resulting appointment window when the booking details change.
    // Guards against clinic-closed days, staff conflicts, and staff reassigned
    // to a service they are not qualified for (parity with the create path).
    // Status-only transitions (confirm/check-in/complete/cancel) are untouched.
    const slotOrStaffChanged =
      data.appointment_date !== undefined ||
      data.start_time !== undefined ||
      data.end_time !== undefined ||
      data.staff_id !== undefined ||
      servicePlan !== null;

    if (slotOrStaffChanged) {
      // Past-date gate: only explicit date changes are checked, so notes/staff
      // edits on existing (even past) appointments remain allowed.
      if (data.appointment_date && data.appointment_date < this.localDateString()) {
        throw new AppError(
          'Cannot reschedule to a past date. Please choose a current or future date.',
          422
        );
      }
      const effectiveDate = data.appointment_date ?? new Date(existing.appointment_date).toISOString().slice(0, 10);
      const effectiveStart = data.start_time ?? existing.start_time;
      const effectiveEnd = servicePlan?.endTime ?? data.end_time ?? existing.end_time;
      const effectiveStaffId = data.staff_id ?? existing.staff_id;

      // Same-day past-time gate: the new start time must still be in the future.
      if (effectiveDate === this.localDateString() && effectiveStart <= this.localTimeString()) {
        throw new AppError(
          'Cannot reschedule to a time that has already passed. Please choose a later time.',
          422
        );
      }

      await this.validateUpdateWindow(
        id,
        effectiveStaffId,
        effectiveDate,
        effectiveStart,
        effectiveEnd
      );
    }

    const updateData: any = {};
    if (data.staff_id !== undefined) updateData.staff_id = data.staff_id;
    if (data.appointment_date !== undefined) updateData.appointment_date = new Date(data.appointment_date);
    if (data.start_time !== undefined) updateData.start_time = data.start_time;
    if (data.end_time !== undefined && !servicePlan) updateData.end_time = data.end_time;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.service_id !== undefined) updateData.service_id = data.service_id;
    if (data.cancellation_reason !== undefined) updateData.cancellation_reason = data.cancellation_reason;
    if (data.reschedule_reason !== undefined) updateData.reschedule_reason = data.reschedule_reason;

    // Manual staff discount. 0 and null both mean "no discount", and are
    // stored as NULL so the column distinguishes "not discounted" from unset.
    // The percentage is a live value, not a baked-in peso amount, so it keeps
    // applying when a later edit re-quotes the booking.
    if (data.discount_pct !== undefined) {
      const pct = data.discount_pct && data.discount_pct > 0 ? data.discount_pct : null;
      updateData.discount_pct = pct;
      if (data.discount_reason !== undefined) {
        updateData.discount_reason = pct ? data.discount_reason ?? null : null;
      } else if (!pct) {
        updateData.discount_reason = null;
      }
    } else if (data.discount_reason !== undefined && data.discount_reason !== null) {
      updateData.discount_reason = data.discount_reason;
    }

    // Cancellation requires a message so the customer can be informed why.
    // Customer self-cancellation is exempt — they supply their own reason and
    // the service fills in a default for the audit trail and the SMS.
    if (data.status === 'cancelled' && !data.cancellation_reason?.trim()) {
      if (isCustomerSelfService) {
        updateData.cancellation_reason = CUSTOMER_CANCEL_REASON;
      } else {
        throw new AppError('Please provide a reason for cancelling the appointment', 400);
      }
    }

    // Recompute quoted price when service or membership changes
    if (data.service_id !== undefined || data.membership_code !== undefined) {
      try {
        const pricing = await pricingService.calculatePrice(
          { serviceId: data.service_id ?? existing.service_id },
          existing.customer_id
        );
        updateData.quoted_price = pricing.finalTotal;
        updateData.price_type = pricing.priceType;
        updateData.membership_code = data.membership_code ?? existing.membership_code;
      } catch {
        // keep existing quoted_price if recalculation fails
      }
    }

    if (data.status) {
      await this.persistUpdate(id, updateData, servicePlan);

      const updated = await prisma.appointments.update({
        where: { id },
        data: { status: data.status },
        include: {
          customer: {
            select: { id: true, first_name: true, last_name: true },
          },
          staff: {
            select: { id: true, first_name: true, last_name: true, position: true },
          },
          service: {
            select: { id: true, name: true, price: true, duration_minutes: true },
          },
        },
      });

      await prisma.appointment_status_history.create({
        data: {
          appointment_id: id,
          old_status: existing.status,
          new_status: data.status,
          reason: data.cancellation_reason ?? null,
          changed_by: context?.userId ?? null,
        },
      });

      // Dispatch notifications only for a genuine status change. Re-saving an
      // appointment without changing its status must not re-send a notification.
      if (existing.status !== data.status) {
        try {
          const customerRecord = await prisma.customers.findUnique({
            where: { id: existing.customer_id },
            select: { user_id: true },
          });
          const customerUser = customerRecord
            ? await prisma.users.findUnique({ where: { id: customerRecord.user_id }, select: { id: true, phone: true } })
            : null;
          const staffRecord = await prisma.staff.findUnique({
            where: { id: existing.staff_id },
            select: { user_id: true },
          });
          const adminUserIds = await notificationDispatch.getAdminUserIds();
          const apptDate = new Date(existing.appointment_date).toLocaleDateString('en-PH', {
            year: 'numeric', month: 'long', day: 'numeric',
          });
          const serviceLabel = servicePlan?.serviceNames.join(', ') ?? updated.service.name;

          // Cancelling always goes through the dedicated dispatcher so the
          // customer gets an automatic SMS regardless of which entry point
          // initiated the cancellation (admin, staff, or the customer).
          if (data.status === 'cancelled') {
            await notificationDispatch.dispatchAppointmentCancelled({
              appointmentId: id,
              customerUserId: customerUser?.id ?? customerRecord?.user_id ?? 0,
              customerName: `${updated.customer.first_name} ${updated.customer.last_name}`,
              customerPhone: customerUser?.phone ?? null,
              staffUserId: staffRecord?.user_id ?? null,
              staffName: `${updated.staff.first_name} ${updated.staff.last_name}`,
              serviceName: serviceLabel,
              appointmentDate: apptDate,
              appointmentTime: existing.start_time,
              reason: updateData.cancellation_reason ?? data.cancellation_reason ?? null,
              cancelledByCustomer: isCustomerSelfService,
              adminUserIds,
            });
          } else {
            await notificationDispatch.dispatchAppointmentStatus({
              appointmentId: id,
              oldStatus: existing.status,
              newStatus: data.status,
              customerUserId: customerUser?.id ?? customerRecord?.user_id ?? 0,
              customerName: `${updated.customer.first_name} ${updated.customer.last_name}`,
              customerPhone: customerUser?.phone ?? null,
              staffUserId: staffRecord?.user_id ?? null,
              staffName: `${updated.staff.first_name} ${updated.staff.last_name}`,
              serviceName: serviceLabel,
              appointmentDate: apptDate,
              appointmentTime: existing.start_time,
              adminUserIds,
            });
          }
        } catch (err: any) {
          logger.error(`[APPOINTMENT] Status-change notification failed for #${id} (${existing.status}->${data.status}): ${err?.message ?? err}`);
        }
      }

      // Tell the customer their booking now covers a different service set.
      if (servicePlan?.changed) {
        try {
          await this.dispatchServiceChangeNotice(
            existing,
            servicePlan,
            data.reschedule_reason ?? data.notes ?? null
          );
        } catch (err: any) {
          logger.error(`[APPOINTMENT] Service-change notification failed for #${id}: ${err?.message ?? err}`);
        }
      }

      // Auto-create treatment record so the customer's treatment history is populated
      if (data.status === 'completed') {
        try {
          await prisma.treatment_records.upsert({
            where: { appointment_id: id },
            update: {},
            create: {
              appointment_id: id,
              staff_id: existing.staff_id,
              customer_id: existing.customer_id,
              service_id: existing.service_id,
              treatment_date: existing.appointment_date,
              start_time: existing.start_time ?? null,
              end_time: existing.end_time ?? null,
              notes: existing.notes ?? null,
            },
          });
        } catch (err: any) {
          // Treatment record creation failure should not block status update
        }
      }

      return updated;
    }

    // Detect a reschedule: appointment date and/or start time actually changed
    const newDate = data.appointment_date ? new Date(data.appointment_date) : existing.appointment_date;
    const newTime = data.start_time ?? existing.start_time;
    const dateChanged = data.appointment_date !== undefined
      && newDate.toISOString().slice(0, 10) !== new Date(existing.appointment_date).toISOString().slice(0, 10);
    const timeChanged = data.start_time !== undefined && data.start_time !== existing.start_time;
    const isReschedule = dateChanged || timeChanged;

    // A reschedule requires a message to inform the customer why
    if (isReschedule && !data.reschedule_reason?.trim()) {
      throw new AppError('Please provide a message explaining the reschedule', 400);
    }

    const appointment = await this.persistUpdateReturning(id, updateData, servicePlan, {
      customer: { select: { id: true, first_name: true, last_name: true } },
      staff: { select: { id: true, first_name: true, last_name: true, position: true } },
      service: { select: { id: true, name: true, price: true, duration_minutes: true } },
      services: {
        include: { service: { select: { id: true, name: true, price: true, duration_minutes: true } } },
        orderBy: { id: 'asc' },
      },
      transactions: { select: PAYMENT_ROW_SELECT },
    });

    if (servicePlan?.changed) {
      try {
        await this.dispatchServiceChangeNotice(
          existing,
          servicePlan,
          data.reschedule_reason ?? data.notes ?? null
        );
      } catch (err: any) {
        logger.error(`[APPOINTMENT] Service-change notification failed: ${err?.message ?? err}`);
      }
    }

    if (isReschedule) {
      // Audit trail in status history (status unchanged, reason carries the message)
      try {
        await prisma.appointment_status_history.create({
          data: {
            appointment_id: id,
            old_status: existing.status,
            new_status: existing.status,
            reason: data.reschedule_reason ?? null,
          },
        });
      } catch (err: any) {
        // History failure should not block reschedule
      }

      // Notify customer (in-app + SMS), assigned staff and admins
      try {
        const customerRecord = await prisma.customers.findUnique({
          where: { id: existing.customer_id },
          select: { user_id: true },
        });
        const customerUser = customerRecord
          ? await prisma.users.findUnique({ where: { id: customerRecord.user_id }, select: { id: true, phone: true } })
          : null;
        const staffRecord = await prisma.staff.findUnique({
          where: { id: existing.staff_id },
          select: { user_id: true },
        });
        const adminUserIds = await notificationDispatch.getAdminUserIds();
        const fmt = (d: Date) => d.toLocaleDateString('en-PH', {
          year: 'numeric', month: 'long', day: 'numeric',
        });

        await notificationDispatch.dispatchAppointmentRescheduled({
          appointmentId: id,
          customerUserId: customerUser?.id ?? customerRecord?.user_id ?? 0,
          customerName: `${appointment.customer.first_name} ${appointment.customer.last_name}`,
          customerPhone: customerUser?.phone ?? null,
          staffUserId: staffRecord?.user_id ?? null,
          staffName: `${appointment.staff.first_name} ${appointment.staff.last_name}`,
          serviceName: appointment.service.name,
          oldDate: fmt(new Date(existing.appointment_date)),
          oldTime: existing.start_time,
          newDate: fmt(newDate),
          newTime,
          reason: data.reschedule_reason ?? null,
          adminUserIds,
        });
      } catch (err: any) {
        logger.error(`[APPOINTMENT] Reschedule notification failed: ${err?.message ?? err}`);
      }
    }

    return this.withServices(appointment);
  }

  async delete(id: number) {
    const existing = await prisma.appointments.findFirst({
      where: { id, deleted_at: null },
    });

    if (!existing) {
      throw new AppError('Appointment not found', 404);
    }

    // Deleting writes status = 'cancelled', which would slip past the
    // completed lock enforced in update().
    if (existing.status === 'completed') {
      throw new AppError(
        'Completed appointments can no longer be deleted.',
        422
      );
    }

    await prisma.appointments.update({
      where: { id },
      data: { deleted_at: new Date(), status: 'cancelled' },
    });

    // Deleting a booking cancels it, so the customer is notified — unless it
    // was already cancelled, in which case a notification was already sent.
    if (existing.status !== 'cancelled') {
      try {
        const [customerRecord, staffRecord, service, adminUserIds] = await Promise.all([
          prisma.customers.findUnique({
            where: { id: existing.customer_id },
            select: { user_id: true, first_name: true, last_name: true },
          }),
          prisma.staff.findUnique({
            where: { id: existing.staff_id },
            select: { user_id: true, first_name: true, last_name: true },
          }),
          prisma.services.findUnique({
            where: { id: existing.service_id },
            select: { name: true },
          }),
          notificationDispatch.getAdminUserIds(),
        ]);
        const customerUser = customerRecord
          ? await prisma.users.findUnique({ where: { id: customerRecord.user_id }, select: { id: true, phone: true } })
          : null;

        await notificationDispatch.dispatchAppointmentCancelled({
          appointmentId: id,
          customerUserId: customerUser?.id ?? customerRecord?.user_id ?? 0,
          customerName: `${customerRecord?.first_name ?? ''} ${customerRecord?.last_name ?? ''}`.trim(),
          customerPhone: customerUser?.phone ?? null,
          staffUserId: staffRecord?.user_id ?? null,
          staffName: `${staffRecord?.first_name ?? ''} ${staffRecord?.last_name ?? ''}`.trim(),
          serviceName: service?.name ?? 'appointment',
          appointmentDate: new Date(existing.appointment_date).toLocaleDateString('en-PH', {
            year: 'numeric', month: 'long', day: 'numeric',
          }),
          appointmentTime: existing.start_time,
          reason: existing.cancellation_reason ?? null,
          cancelledByCustomer: false,
          adminUserIds,
        });
      } catch (err: any) {
        logger.error(`[APPOINTMENT] Deletion notification failed: ${err?.message ?? err}`);
      }
    }
  }

  async getAvailability(staffId: number | undefined, serviceId: number, date: string, durationOverride?: number) {
    if (!serviceId || !date) {
      throw new AppError('service_id and date are required', 400);
    }

    if (date < this.localDateString()) {
      throw new AppError(
        'Cannot check availability for a past date. Please choose a current or future date.',
        422
      );
    }

    const service = await prisma.services.findFirst({
      where: { id: serviceId, deleted_at: null },
    });
    if (!service) {
      throw new AppError('Service not found', 404);
    }

    // Clinic-wide operating days gate: if the clinic is closed this weekday, no
    // slots are offered regardless of individual staff schedules.
    const businessHours = await this.getBusinessHours();
    const closedWeekdays = await this.getClosedWeekdays();
    if (closedWeekdays.has(this.weekdayOf(date))) {
      const busy = await prisma.appointments.findMany({
        where: { service_id: serviceId, appointment_date: new Date(date), status: { notIn: ['cancelled', 'no_show'] }, deleted_at: null },
        select: { staff_id: true, start_time: true, end_time: true },
      });
      return {
        date,
        staff_id: staffId ?? undefined,
        service_id: serviceId,
        closed: true,
        closed_reason: 'The clinic is closed on this day.',
        duration_minutes: durationOverride || service.duration_minutes,
        available_slots: [],
        booked_appointments: busy,
        business_hours: {
          start: businessHours.start,
          end: businessHours.end,
          label: this.formatHoursLabel(businessHours),
        },
      };
    }

    const durationMinutes = durationOverride || service.duration_minutes;

    // Resolve which staff to check availability for.
    let staffList: any[];
    if (staffId) {
      const staff = await prisma.staff.findFirst({
        where: { id: staffId, deleted_at: null },
      });
      if (!staff) {
        throw new AppError('Staff not found', 404);
      }
      staffList = [staff];
    } else {
      staffList = await prisma.staff.findMany({
        where: { deleted_at: null, status: 'active' },
      });
    }

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    const weekday = days[new Date(`${date}T00:00:00`).getDay()];

    const schedules = await prisma.staff_schedules.findMany({
      where: {
        staff_id: { in: staffList.map((s) => s.id) },
        day_of_week: weekday,
      },
    });
    const scheduleByStaff = new Map(schedules.map((s) => [s.staff_id, s]));

    const existingAppointments = await prisma.appointments.findMany({
      where: {
        staff_id: { in: staffList.map((s) => s.id) },
        appointment_date: new Date(date),
        status: { notIn: ['cancelled', 'no_show'] },
        deleted_at: null,
      },
      select: { staff_id: true, start_time: true, end_time: true },
    });

    const isToday = date === this.localDateString();
    const nowMin = this.timeToMinutes(this.localTimeString());

    // Store hours bound the bookable window. A specialist scheduled past
    // closing (or a shift that starts before opening) must not offer slots the
    // clinic cannot actually serve.
    const openMin = this.timeToMinutes(businessHours.start);
    const closeMin = this.timeToMinutes(businessHours.end);

    const availableSlots: Array<{
      start: string;
      end: string;
      staff_id: number;
      staff_name: string;
    }> = [];

    // Per-minute availability: every minute inside a specialist's shift is a
    // real, bookable slot as long as the full service duration fits inside the
    // shift, no booked minute falls inside the window, the window does not
    // overlap a break, and it is not in the past (same-day). The customer's
    // exact pick (e.g. 12:10) is always honoured — it is never snapped.
    for (const staff of staffList) {
      const schedule = scheduleByStaff.get(staff.id);

      // A staff member with no schedule row for this weekday, an inactive
      // schedule, or an explicit off-day (00:00-00:00) is NOT available.
      // There is no default work window — shifts must be configured by an
      // admin or the staff member will not appear in customer availability.
      if (!schedule) continue;
      if (!schedule.is_active) continue;
      if (schedule.start_time === '00:00' && schedule.end_time === '00:00') continue;

      const shiftStartMin = this.timeToMinutes(schedule.start_time);
      const shiftEndMin = this.timeToMinutes(schedule.end_time);
      if (shiftEndMin <= shiftStartMin) continue;

      // Clamp the staff shift to the clinic's opening hours. A shift that runs
      // 10:00–22:00 with the store closing at 20:00 only yields slots up to
      // 20:00 minus the service duration.
      const windowStartMin = Math.max(shiftStartMin, openMin);
      const windowEndMin = Math.min(shiftEndMin, closeMin);
      if (windowEndMin <= windowStartMin) continue;

      const breakStart = schedule.break_start ? this.timeToMinutes(schedule.break_start) : null;
      const breakEnd = schedule.break_end ? this.timeToMinutes(schedule.break_end) : null;

      // Mark every booked minute of this specialist's day so an arbitrary
      // start time can be checked against the exact window it occupies.
      const booked = new Set<number>();
      for (const appt of existingAppointments) {
        if (appt.staff_id !== staff.id) continue;
        const aStart = this.timeToMinutes(appt.start_time);
        const aEnd = this.timeToMinutes(appt.end_time);
        for (let m = aStart; m < aEnd; m++) booked.add(m);
      }

      const lastStart = windowEndMin - durationMinutes;
      for (let s = windowStartMin; s <= lastStart; s++) {
        if (isToday && s <= nowMin) continue;

        let free = true;
        for (let i = 0; i < durationMinutes; i++) {
          if (booked.has(s + i)) {
            free = false;
            break;
          }
        }
        if (!free) continue;

        if (breakStart !== null && breakEnd !== null) {
          if (s < breakEnd && s + durationMinutes > breakStart) continue;
        }

        availableSlots.push({
          start: this.minutesToTime(s),
          end: this.minutesToTime(s + durationMinutes),
          staff_id: staff.id,
          staff_name: `${staff.first_name} ${staff.last_name}`,
        });
      }
    }

    availableSlots.sort(
      (a, b) => a.start.localeCompare(b.start) || a.staff_id - b.staff_id
    );

    return {
      date,
      staff_id: staffId ?? undefined,
      service_id: serviceId,
      duration_minutes: durationMinutes,
      available_slots: availableSlots,
      booked_appointments: existingAppointments,
      // Store hours are echoed so the picker can explain a closed/out-of-hours
      // choice instead of implying the specialist is already booked.
      business_hours: {
        start: businessHours.start,
        end: businessHours.end,
        label: this.formatHoursLabel(businessHours),
      },
    };
  }

  // Sends automatic appointment reminders for tomorrow's confirmed/pending
  // appointments. Runs once daily (see server.ts scheduler). Each appointment
  // is reminded at most once, guarded by the `reminder_sent` flag.
  async processAppointmentReminders(): Promise<{ reminded: number; failed: number }> {
    const tomorrow = this.localDateString(new Date(this.clinicNow().getTime() + 24 * 60 * 60 * 1000));

    const rows = await prisma.appointments.findMany({
      where: {
        appointment_date: new Date(tomorrow),
        status: { in: ['confirmed', 'pending'] },
        reminder_sent: false,
        deleted_at: null,
      },
      include: {
        customer: {
          include: { user: { select: { id: true, phone: true } } },
        },
        service: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    });

    let reminded = 0;
    let failed = 0;

    for (const appointment of rows) {
      const customer = appointment.customer;
      const phone = customer.user?.phone ?? null;

      if (!customer.user) {
        // No user account tied to the customer; mark as reminded to avoid retries.
        await prisma.appointments.update({
          where: { id: appointment.id },
          data: { reminder_sent: true },
        });
        continue;
      }

      const serviceNames = (appointment.services?.length
        ? appointment.services.map((s: any) => s.service.name).join(', ')
        : appointment.service?.name) ?? '';

      const [, month, day] = tomorrow.split('-');
      const message =
        `Hi ${customer.first_name}, this is a reminder from Souvari Skin Lab: your ${serviceNames} ` +
        `appointment is on ${month}-${day} at ${appointment.start_time}. See you!`;

      try {
        await notificationDispatch.dispatch({
          userId: customer.user.id,
          type: 'appointment_reminder',
          title: 'Appointment Reminder',
          message,
          data: { appointment_id: appointment.id },
          sendSMS: true,
          smsPhone: phone ?? undefined,
        });
        reminded += 1;
      } catch (err: any) {
        failed += 1;
        logger.error(`[REMINDER] Failed for appointment ${appointment.id}: ${err.message}`);
      }

      await prisma.appointments.update({
        where: { id: appointment.id },
        data: { reminder_sent: true },
      });
    }

    return { reminded, failed };
  }

  // Validates the resulting appointment window for an update: the clinic must
  // be open, the assigned staff must be qualified for the service, and the
  // staff must have no conflicting (non-cancelled) appointment covering the
  // window. The appointment being updated is excluded from the conflict scan.
private async validateUpdateWindow(
    appointmentId: number,
    staffId: number,
    appointmentDate: string,
    startTime: string,
    endTime: string
  ): Promise<void> {
    const closedWeekdays = await this.getClosedWeekdays();
    if (closedWeekdays.has(this.weekdayOf(appointmentDate))) {
      throw new AppError(
        'The clinic is closed on this day. Please choose an operating day.',
        422
      );
    }

    // A booking may never be moved to a specialist who is off on the effective
    // date, and the window must fit their shift and break — enforced for both
    // updates here and creates in resolveStaff. The store-hours gate runs first
    // so an out-of-hours move reports the correct reason.
    await this.assertWithinBusinessHours(startTime, endTime);
    await this.assertStaffWorkable(staffId, appointmentDate, startTime, endTime);

    const conflicts = await prisma.appointments.findMany({
      where: {
        staff_id: staffId,
        appointment_date: new Date(appointmentDate),
        status: { notIn: ['cancelled', 'no_show'] },
        deleted_at: null,
        id: { not: appointmentId },
        OR: [{ start_time: { lt: endTime }, end_time: { gt: startTime } }],
      },
      select: { id: true },
    });

    if (conflicts.length > 0) {
      throw new AppError('Staff member already has an appointment during this time slot', 409);
    }
  }

  // ─── Service list replacement ────────────────────────────────────────
  // Resolves and prices a replacement service list without writing anything.
  // Returned separately from the write so the caller can feed the derived
  // end_time into validateUpdateWindow before any mutation happens.
  private async planServiceChange(
    existing: any,
    requestedIds: number[],
    startTime?: string
  ): Promise<ServiceChangePlan> {
    // Dedupe while preserving the caller's ordering.
    const serviceIds = [...new Set(requestedIds)];

    const services = await prisma.services.findMany({
      where: { id: { in: serviceIds }, deleted_at: null },
    });
    if (services.length !== serviceIds.length) {
      throw new AppError('One or more services not found', 404);
    }
    const ordered = serviceIds
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);

    const totalDuration = ordered.reduce((sum, s) => sum + s.duration_minutes, 0);
    // Anchor the derived end time to the start the appointment will actually
    // have, so changing both the time and the services in one request is safe.
    const effectiveStart = startTime ?? existing.start_time;
    const endTime = this.addMinutesToTime(effectiveStart, totalDuration);

    // Re-price every line so membership and monthly-perk discounts stay
    // accurate on the enlarged booking.
    const lines: ServiceChangePlan['lines'] = [];
    let quotedPrice = 0;
    let priceType: string | null = null;
    for (const svc of ordered) {
      let unitPrice = Number(svc.price);
      try {
        const pricing = await pricingService.calculatePrice(
          { serviceId: svc.id, membershipCode: existing.membership_code ?? undefined },
          existing.customer_id
        );
        unitPrice = pricing.applicablePrice;
        quotedPrice += pricing.finalTotal;
        if (!priceType) priceType = pricing.priceType;
      } catch {
        quotedPrice += unitPrice;
      }
      lines.push({
        service_id: svc.id,
        unit_price: Math.round(unitPrice * 100) / 100,
        duration_minutes: svc.duration_minutes,
      });
    }

    // Skip the write entirely when the selection is unchanged, so an
    // idempotent save does not churn rows or re-notify the customer.
    const currentRows = await prisma.appointment_services.findMany({
      where: { appointment_id: existing.id },
      select: { service_id: true },
      orderBy: { id: 'asc' },
    });
    const currentIds = currentRows.map((r) => r.service_id);
    const changed =
      currentIds.length !== serviceIds.length ||
      currentIds.some((id, i) => id !== serviceIds[i]);

    const previousIds = new Set(currentIds);
    const serviceNames = ordered.map((s) => s.name);
    const addedServiceNames = serviceNames.filter((_, i) => !previousIds.has(serviceIds[i]));

    return {
      serviceIds,
      serviceNames,
      endTime,
      quotedPrice: Math.round(quotedPrice * 100) / 100,
      priceType,
      lines,
      addedServiceNames,
      changed,
    };
  }

  // Merges the derived service fields into the appointment field update.
  private buildAppointmentUpdate(updateData: any, plan: ServiceChangePlan | null): any {
    if (!plan) return updateData;
    return {
      ...updateData,
      end_time: plan.endTime,
      quoted_price: plan.quotedPrice,
      price_type: plan.priceType,
      service_id: plan.serviceIds[0],
    };
  }

  private buildServiceRows(id: number, plan: ServiceChangePlan) {
    return plan.lines.map((l) => ({
      appointment_id: id,
      service_id: l.service_id,
      unit_price: l.unit_price,
      duration_minutes: l.duration_minutes,
    }));
  }

  /** Writes the appointment fields plus the replacement service rows atomically. */
  private async persistUpdate(
    id: number,
    updateData: any,
    plan: ServiceChangePlan | null
  ): Promise<void> {
    const data = this.buildAppointmentUpdate(updateData, plan);

    if (!plan || !plan.changed) {
      await prisma.appointments.update({ where: { id }, data });
      return;
    }

    await prisma.$transaction([
      prisma.appointments.update({ where: { id }, data }),
      prisma.appointment_services.deleteMany({ where: { appointment_id: id } }),
      prisma.appointment_services.createMany({ data: this.buildServiceRows(id, plan) }),
    ]);
  }

  /** Same as {@link persistUpdate} but returns the row with its relations. */
  private async persistUpdateReturning(
    id: number,
    updateData: any,
    plan: ServiceChangePlan | null,
    include: any
  ): Promise<any> {
    const data = this.buildAppointmentUpdate(updateData, plan);

    if (!plan || !plan.changed) {
      return prisma.appointments.update({ where: { id }, data, include });
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.appointments.update({ where: { id }, data, include });
      await tx.appointment_services.deleteMany({ where: { appointment_id: id } });
      await tx.appointment_services.createMany({ data: this.buildServiceRows(id, plan) });
      return updated;
    });
  }

  // Notifies the customer (in-app + SMS) that their booking now covers a
  // different set of services, plus the assigned staff and admins.
  private async dispatchServiceChangeNotice(
    existing: any,
    plan: ServiceChangePlan,
    note: string | null
  ): Promise<void> {
    const [customerRecord, staffRecord, adminUserIds] = await Promise.all([
      prisma.customers.findUnique({
        where: { id: existing.customer_id },
        select: { user_id: true, first_name: true, last_name: true },
      }),
      prisma.staff.findUnique({
        where: { id: existing.staff_id },
        select: { user_id: true, first_name: true, last_name: true },
      }),
      notificationDispatch.getAdminUserIds(),
    ]);

    const customerUser = customerRecord
      ? await prisma.users.findUnique({
          where: { id: customerRecord.user_id },
          select: { id: true, phone: true },
        })
      : null;

    const apptDate = new Date(existing.appointment_date).toLocaleDateString('en-PH', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    await notificationDispatch.dispatchAppointmentServicesChanged({
      appointmentId: existing.id,
      customerUserId: customerUser?.id ?? customerRecord?.user_id ?? 0,
      customerName: customerRecord
        ? `${customerRecord.first_name} ${customerRecord.last_name}`
        : 'Customer',
      customerPhone: customerUser?.phone ?? null,
      staffUserId: staffRecord?.user_id ?? null,
      staffName: staffRecord ? `${staffRecord.first_name} ${staffRecord.last_name}` : '',
      serviceNames: plan.serviceNames,
      addedServiceNames: plan.addedServiceNames,
      appointmentDate: apptDate,
      appointmentTime: existing.start_time,
      newEndTime: plan.endTime,
      quotedPrice: plan.quotedPrice,
      note: note?.trim() || null,
      adminUserIds,
    });
  }

  /**
   * Counts upcoming, still-actionable bookings per weekday. Backs the admin
   * "days the store is open" warning so closing a day does not silently
   * strand customers who already have bookings on it.
   */
  async getOperatingDaysImpact(days: WeekdayName[]) {
    const from = new Date(this.localDateString());
    const rows = await prisma.appointments.findMany({
      where: {
        appointment_date: { gte: from },
        status: { notIn: ['cancelled', 'no_show', 'completed'] },
        deleted_at: null,
      },
      select: { appointment_date: true },
    });

    const byWeekday = new Map<WeekdayName, number>();
    for (const row of rows) {
      // appointment_date is a DATE column stored at UTC midnight; read the UTC
      // components so the weekday matches what the calendar displays.
      const name = WEEKDAY_NAMES_BY_JS[row.appointment_date.getUTCDay()];
      byWeekday.set(name, (byWeekday.get(name) ?? 0) + 1);
    }

    return days.map((day) => ({ day, upcoming_count: byWeekday.get(day) ?? 0 }));
  }

  // ─── Weekday helpers for clinic-wide closed-day enforcement. ─────────
  // JS getDay() numbering: 0=Sunday … 6=Saturday. appointment_date is a DATE
  // column stored at UTC midnight, so read the weekday in UTC too — otherwise
  // the server's own timezone can shift the answer by a day.
  private weekdayOf(dateStr: string): number {
    return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  }

  // Weekdays the clinic is routinely closed. Computed as the complement of the
  // `business_days` system setting (the authoritative operating-week policy).
  private async getClosedWeekdays(): Promise<Set<number>> {
    const rows = await prisma.system_settings.findMany({
      where: { setting_key: 'business_days' },
    });
    const open = rows.length > 0
      ? JSON.parse(rows[0].setting_value)
      : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekdayNumber: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    };
    const openSet = new Set((Array.isArray(open) ? open : []).map((d: string) => weekdayNumber[d.toLowerCase?.() ?? d]));
    return new Set([0, 1, 2, 3, 4, 5, 6].filter((n) => !openSet.has(n)));
  }

  // The clinic's opening/closing time for a day, from the `business_hours_start`
  // / `business_hours_end` system settings. Defaults mirror the seed (10:00 and
  // 20:00) so a database without the settings still behaves sensibly. These are
  // the *store* hours; individual specialists may be scheduled within them.
  private async getBusinessHours(): Promise<{ start: string; end: string }> {
    const rows = await prisma.system_settings.findMany({
      where: { setting_key: { in: ['business_hours_start', 'business_hours_end'] } },
    });
    const byKey = new Map(rows.map((r) => [r.setting_key, String(r.setting_value).replace(/^"|"$/g, '')]));
    const start = byKey.get('business_hours_start') || '10:00';
    const end = byKey.get('business_hours_end') || '20:00';
    return { start, end };
  }

  private formatHoursLabel(hours: { start: string; end: string }): string {
    const label = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const period = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, '0')} ${period}`;
    };
    return `${label(hours.start)}–${label(hours.end)}`;
  }

  // Rejects a booking window that falls outside the clinic's opening hours.
  // Staff shifts are validated separately; this is the store-level gate so a
  // late shift can never expose post-closing slots (e.g. 10 PM after an 8 PM
  // close), which previously surfaced as a misleading staff-conflict error.
  private async assertWithinBusinessHours(startTime: string, endTime: string): Promise<void> {
    const hours = await this.getBusinessHours();
    const openMin = this.timeToMinutes(hours.start);
    const closeMin = this.timeToMinutes(hours.end);
    const startMin = this.timeToMinutes(startTime);
    const endMin = this.timeToMinutes(endTime);
    if (startMin < openMin || endMin > closeMin) {
      throw new AppError(
        `The clinic is open ${this.formatHoursLabel(hours)}. Please choose a time within these hours.`,
        422
      );
    }
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private minutesToTime(total: number): string {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private addMinutesToTime(time: string, minutes: number): string {
    const total = this.timeToMinutes(time) + minutes;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  private clinicNow(): Date {
    // Asia/Manila is UTC+8 with no DST: getTimezoneOffset() === -480.
    const TARGET_OFFSET_MIN = -480;
    const now = new Date();
    const diffMin = TARGET_OFFSET_MIN - now.getTimezoneOffset();
    return new Date(now.getTime() + diffMin * 60000);
  }

  private localDateString(date?: Date): string {
    const now = date ?? this.clinicNow();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // `appointment_date` is stored as a DATE column at UTC midnight, so read its
  // UTC parts when comparing to a bare YYYY-MM-DD — a local read would shift
  // the day for timezones behind UTC.
  private dateStringOf(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private localTimeString(): string {
    const now = this.clinicNow();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}

export const appointmentService = new AppointmentService();

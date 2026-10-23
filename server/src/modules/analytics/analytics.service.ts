import prisma from '../../config/database';
import { RevenueQuery, AppointmentTrendsQuery, SummaryQuery } from './analytics.validation';
import { clinicMonthRange, transactionDateFilter, transactionReportDate } from '../transactions/transaction-dates';
import { clinicDayStartUtc, clinicDayEndUtc, toLocalDayKey } from '../transactions/transactions-report-math';

function analyticsPeriod(startDate?: string, endDate?: string) {
  const now = new Date();
  const from = startDate ?? toLocalDayKey(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const to = endDate ?? toLocalDayKey(now);
  return { from, to, start: clinicDayStartUtc(from)!, end: clinicDayEndUtc(to)! };
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

class AnalyticsService {
  async getDashboard() {
    const month = clinicMonthRange();
    const startOfMonth = clinicDayStartUtc(month.from)!;
    const endOfMonth = clinicDayEndUtc(month.to)!;

    const [
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      noShowAppointments,
      monthlyRevenue,
      totalCustomers,
      totalStaff,
    ] = await Promise.all([
      prisma.appointments.count({
        where: {
          appointment_date: { gte: startOfMonth, lte: endOfMonth },
          deleted_at: null,
        },
      }),
      prisma.appointments.count({
        where: {
          appointment_date: { gte: startOfMonth, lte: endOfMonth },
          status: 'completed',
          deleted_at: null,
        },
      }),
      prisma.appointments.count({
        where: {
          appointment_date: { gte: startOfMonth, lte: endOfMonth },
          status: 'cancelled',
          deleted_at: null,
        },
      }),
      prisma.appointments.count({
        where: {
          appointment_date: { gte: startOfMonth, lte: endOfMonth },
          status: 'no_show',
          deleted_at: null,
        },
      }),
      prisma.transactions.aggregate({
        where: {
          ...transactionDateFilter(month.from, month.to),
          payment_status: 'paid',
          deleted_at: null,
        },
        _sum: { total_amount: true },
      }),
      prisma.customers.count({ where: { deleted_at: null } }),
      prisma.staff.count({
        where: { status: 'active', deleted_at: null },
      }),
    ]);

    const lowStockResult = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM products
      WHERE deleted_at IS NULL AND current_stock > 0 AND current_stock <= minimum_stock
    `;
    const lowStockCount = Number(lowStockResult[0]?.count || 0);

    return {
      total_appointments: totalAppointments,
      completed: completedAppointments,
      cancelled: cancelledAppointments,
      no_show: noShowAppointments,
      total_revenue: Number(monthlyRevenue._sum.total_amount || 0),
      total_customers: totalCustomers,
      total_staff: totalStaff,
      low_stock_count: lowStockCount,
    };
  }

  async getRevenue(query: RevenueQuery) {
    const { start_date, end_date, group_by } = query;

    const { from, to } = analyticsPeriod(start_date, end_date);

    const transactions = await prisma.transactions.findMany({
      where: {
        ...transactionDateFilter(from, to),
        payment_status: 'paid',
        deleted_at: null,
      },
      select: {
        total_amount: true,
        created_at: true,
        appointment: { select: { appointment_date: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    const grouped: Record<string, number> = {};

    for (const t of transactions) {
      let key: string;
      const dayKey = toLocalDayKey(transactionReportDate(t));

      if (group_by === 'month') {
        key = dayKey.slice(0, 7);
      } else if (group_by === 'week') {
        const weekStart = new Date(`${dayKey}T00:00:00.000Z`);
        weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = dayKey;
      }

      grouped[key] = (grouped[key] || 0) + Number(t.total_amount);
    }

    const data = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({
      date,
      revenue: Math.round(revenue * 100) / 100,
    }));

    return { data, group_by };
  }

  async getAppointmentTrends(query: AppointmentTrendsQuery) {
    const { start_date, end_date } = query;

    const { start, end } = analyticsPeriod(start_date, end_date);

    const appointments = await prisma.appointments.findMany({
      where: {
        appointment_date: { gte: start, lte: end },
        deleted_at: null,
      },
      select: {
        appointment_date: true,
        status: true,
      },
      orderBy: { appointment_date: 'asc' },
    });

    const grouped: Record<string, Record<string, number>> = {};

    for (const a of appointments) {
      const key = new Date(a.appointment_date).toISOString().split('T')[0];
      if (!grouped[key]) {
        grouped[key] = {
          total: 0,
          pending: 0,
          confirmed: 0,
          checked_in: 0,
          in_progress: 0,
          completed: 0,
          cancelled: 0,
          no_show: 0,
        };
      }
      grouped[key].total += 1;
      if (grouped[key][a.status] !== undefined) {
        grouped[key][a.status] += 1;
      }
    }

    const data = Object.entries(grouped).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    return data;
  }

  async getServices() {
    const services = await prisma.services.findMany({
      where: { deleted_at: null, status: 'active' },
      include: {
        appointments: {
          where: { deleted_at: null },
          select: { id: true },
        },
        transaction_items: {
          select: { line_total: true },
        },
      },
    });

    const serviceData = services.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      price: Number(s.price),
      appointment_count: s.appointments.length,
      total_revenue: s.transaction_items.reduce((sum, item) => sum + Number(item.line_total), 0),
    }));

    serviceData.sort((a, b) => b.appointment_count - a.appointment_count);

    return serviceData;
  }

  async getInventory() {
    const [products, lowStockResult, outOfStockResult] = await Promise.all([
      prisma.products.findMany({
        where: { deleted_at: null },
        select: {
          id: true,
          name: true,
          current_stock: true,
          unit_cost: true,
        },
      }),
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*) as count FROM products
        WHERE deleted_at IS NULL AND current_stock > 0 AND current_stock <= minimum_stock
      `,
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*) as count FROM products
        WHERE deleted_at IS NULL AND current_stock = 0
      `,
    ]);

    const lowStockCount = Number(lowStockResult[0]?.count || 0);
    const outOfStockCount = Number(outOfStockResult[0]?.count || 0);

    const totalValue = products.reduce(
      (sum, p) => sum + Number(p.current_stock) * Number(p.unit_cost),
      0
    );

    return {
      total_products: products.length,
      total_value: totalValue,
      low_stock_count: lowStockCount,
      out_of_stock_count: outOfStockCount,
    };
  }

  async getSummary(query: SummaryQuery) {
    const { start_date, end_date } = query;

    const { from, to, start, end } = analyticsPeriod(start_date, end_date);

    const CANCELLED_LIKE = ['cancelled', 'no_show'];

    const [transactions, appointments, staffRows] = await Promise.all([
      prisma.transactions.findMany({
        where: {
          ...transactionDateFilter(from, to),
          payment_status: 'paid',
          deleted_at: null,
        },
        select: { id: true, total_amount: true, staff_id: true, customer_id: true },
      }),
      prisma.appointments.findMany({
        where: {
          appointment_date: { gte: start, lte: end },
          deleted_at: null,
        },
        select: {
          id: true,
          customer_id: true,
          staff_id: true,
          status: true,
          appointment_date: true,
          start_time: true,
          end_time: true,
        },
      }),
      prisma.staff.findMany({
        where: { status: 'active', deleted_at: null },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          avatar_url: true,
          schedules: {
            where: { is_active: true },
            select: { day_of_week: true, start_time: true, end_time: true, break_start: true, break_end: true },
          },
        },
      }),
    ]);

    const approvedBookings = appointments.filter((a) => !CANCELLED_LIKE.includes(a.status));
    const bookedMap: Map<string, number> = new Map(); // date -> booked minutes
    let bookedMinutes = 0;
    for (const a of approvedBookings) {
      const mins = Math.max(0, toMinutes(a.end_time || '00:00') - toMinutes(a.start_time || '00:00'));
      bookedMinutes += mins;
      const key = new Date(a.appointment_date).toISOString().split('T')[0];
      bookedMap.set(key, (bookedMap.get(key) || 0) + mins);
    }

    // Working minutes: one map for totals per date, one per staff.
    const schedPerStaff: Record<number, { day: number; start: number; end: number; breakStart?: number; breakEnd?: number }[]> = {};
    for (const s of staffRows) {
      const list = s.schedules
        .filter((sc) => DAY_INDEX[sc.day_of_week] !== undefined)
        .map((sc) => ({
          day: DAY_INDEX[sc.day_of_week],
          start: toMinutes(sc.start_time),
          end: toMinutes(sc.end_time),
          breakStart: sc.break_start ? toMinutes(sc.break_start) : undefined,
          breakEnd: sc.break_end ? toMinutes(sc.break_end) : undefined,
        }));
      schedPerStaff[s.id] = list;
    }

    const workingMinOn = (dayIndex: number, sc: { day: number; start: number; end: number; breakStart?: number; breakEnd?: number }[]) => {
      let total = 0;
      for (const s of sc) {
        if (s.day !== dayIndex) continue;
        let span = s.end - s.start;
        if (s.breakStart !== undefined && s.breakEnd !== undefined) span -= Math.max(0, s.breakEnd - s.breakStart);
        total += Math.max(0, span);
      }
      return total;
    };

    // Build the ordered date keys for the range (pure YYYY-MM-DD strings, TZ-safe).
    const dateKeys: string[] = [];
    const firstKey = from;
    const lastKey = to;
    const cursor = new Date(firstKey + 'T00:00:00.000Z');
    const stop = new Date(lastKey + 'T00:00:00.000Z');
    while (cursor <= stop) {
      dateKeys.push(cursor.toISOString().split('T')[0]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    let workingMinutes = 0;
    const staffWorkingMap: Record<number, number> = {};
    const series: { date: string; rate: number }[] = [];
    for (const key of dateKeys) {
      const dayIndex = new Date(key + 'T12:00:00.000Z').getUTCDay();
      let dayWorking = 0;
      for (const s of staffRows) {
        const w = workingMinOn(dayIndex, schedPerStaff[s.id] || []);
        dayWorking += w;
        staffWorkingMap[s.id] = (staffWorkingMap[s.id] || 0) + w;
      }
      workingMinutes += dayWorking;
      const booked = bookedMap.get(key) || 0;
      const rate = dayWorking > 0 && booked > 0 ? Math.min(100, Math.round((booked / dayWorking) * 100)) : 0;
      series.push({ date: key, rate });
    }

    const unbookedMinutes = Math.max(0, workingMinutes - bookedMinutes);
    const occupancyRate = workingMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / workingMinutes) * 100))
      : 0;

    // Paid transaction totals
    const totalRevenue = transactions.reduce((s, t) => s + Number(t.total_amount), 0);
    const avgSale = transactions.length ? Math.round((totalRevenue / transactions.length) * 100) / 100 : 0;

    // Patient acquisition (new vs returning)
    const activeCustomers = [...new Set(appointments.map((a) => a.customer_id))];
    let priorCustomerIds = new Set<number>();
    if (activeCustomers.length > 0) {
      const [priorAppt, priorTx] = await Promise.all([
        prisma.appointments.groupBy({
          by: ['customer_id'],
          where: { customer_id: { in: activeCustomers }, appointment_date: { lt: start }, deleted_at: null },
          _count: { _all: true },
        }),
        prisma.transactions.groupBy({
          by: ['customer_id'],
          where: { customer_id: { in: activeCustomers }, created_at: { lt: start }, payment_status: 'paid', deleted_at: null },
          _count: { _all: true },
        }),
      ]);
      priorCustomerIds = new Set([
        ...priorAppt.map((p) => p.customer_id),
        ...priorTx.map((p) => p.customer_id!),
      ]);
    }
    const returningPatients = activeCustomers.filter((id) => priorCustomerIds.has(id)).length;
    const newPatients = Math.max(0, activeCustomers.length - returningPatients);
    const returningPatientRate = activeCustomers.length
      ? Math.round((returningPatients / activeCustomers.length) * 100)
      : 0;

    // Per-staff performance
    const staff = staffRows.map((s) => {
      const sTransactions = transactions.filter((t) => t.staff_id === s.id);
      const sBookings = appointments.filter((a) => a.staff_id === s.id);
      const sApproved = sBookings.filter((a) => !CANCELLED_LIKE.includes(a.status));
      const sBookedMinutes = sApproved.reduce((acc, a) => acc + Math.max(0, toMinutes(a.end_time || '00:00') - toMinutes(a.start_time || '00:00')), 0);
      const sWorking = staffWorkingMap[s.id] || 0;
      const sOccupancy = sWorking > 0 ? Math.min(100, Math.round((sBookedMinutes / sWorking) * 100)) : 0;
      const sPatients = [...new Set(sBookings.map((a) => a.customer_id))];
      const sReturning = sPatients.filter((id) => priorCustomerIds.has(id)).length;
      return {
        id: s.id,
        full_name: `${s.first_name} ${s.last_name}`,
        avatar_url: s.avatar_url,
        revenue: Math.round(sTransactions.reduce((acc, t) => acc + Number(t.total_amount), 0) * 100) / 100,
        bookings: sBookings.length,
        occupancy_rate: sOccupancy,
        patients: sPatients.length,
        returning_patients: sReturning,
      };
    });

    staff.sort((a, b) => b.revenue - a.revenue);

    return {
      transaction_count: transactions.length,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_sale: avgSale,
      occupancy: {
        rate: occupancyRate,
        working_minutes: workingMinutes,
        booked_minutes: bookedMinutes,
        unbooked_minutes: unbookedMinutes,
        series,
      },
      returning_patient_rate: returningPatientRate,
      patients: {
        active: activeCustomers.length,
        new_patients: newPatients,
        returning_patients: returningPatients,
      },
      staff,
    };
  }
}

export const analyticsService = new AnalyticsService();

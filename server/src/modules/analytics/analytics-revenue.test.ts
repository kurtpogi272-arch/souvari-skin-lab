import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  transactions: { findMany: vi.fn(), aggregate: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  appointments: { count: vi.fn(), findMany: vi.fn() },
  customers: { count: vi.fn() }, staff: { count: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../../config/database', () => ({ default: db }));
vi.mock('../../services/notification-dispatch.service', () => ({ notificationDispatch: {} }));

import { analyticsService } from './analytics.service';
import { transactionService } from '../transactions/transactions.service';
import { clinicMonthRange } from '../transactions/transaction-dates';

function transaction(id: number, created: string, amount: number, visit?: string, overrides: any = {}) {
  return {
    id, transaction_number: `TXN-${id}`, created_at: new Date(created),
    total_amount: amount, subtotal: amount, discount_amount: 0, tax_amount: 0,
    payment_status: 'paid', payment_method: 'cash', type: 'sale', deleted_at: null,
    appointment_id: visit ? id : null,
    appointment: visit ? { appointment_date: new Date(`${visit}T00:00:00Z`) } : null,
    customer: null, staff: null, items: [], notes: null,
    ...overrides,
  };
}

const rows = [
  transaction(1, '2026-09-15T08:00:00Z', 1000, '2026-10-01'), // October visit, recorded in September
  transaction(2, '2026-10-15T08:00:00Z', 9000, '2026-09-30'), // September visit, recorded in October
  transaction(3, '2026-09-30T16:00:00Z', 200), // October 1, exactly midnight Manila
  transaction(4, '2026-10-31T15:59:59.999Z', 300), // October 31, last millisecond Manila
  transaction(5, '2026-09-30T15:59:59.999Z', 7000), // Still September in Manila
  transaction(6, '2026-10-31T16:00:00Z', 8000), // Already November in Manila
  transaction(7, '2026-11-05T08:00:00Z', 500, '2026-10-31'), // October visit, recorded in November
  transaction(8, '2026-10-15T08:00:00Z', 6000, undefined, { payment_status: 'pending' }),
  transaction(9, '2026-10-15T08:00:00Z', 5000, undefined, { payment_status: 'voided' }),
  transaction(10, '2026-10-15T08:00:00Z', 4000, undefined, { deleted_at: new Date() }),
  transaction(11, '2026-10-20T08:00:00Z', -100, undefined, { type: 'refund' }),
];

// Small generic evaluator for Prisma's scalar and relation predicates. It lets
// the real service queries select the fixture set, rather than preselecting it
// for each endpoint and hiding disagreements in their filters.
function matches(record: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every((c) => matches(record, c));
    if (key === 'OR') return condition.some((c: any) => matches(record, c));
    const value = record[key];
    if (condition === null || typeof condition !== 'object') return value === condition;
    if ('gte' in condition || 'lte' in condition) {
      return value instanceof Date && (!condition.gte || value >= condition.gte) && (!condition.lte || value <= condition.lte);
    }
    if ('contains' in condition) return String(value ?? '').includes(condition.contains);
    return value != null && matches(value, condition);
  });
}

const october = { date_from: '2026-10-01', date_to: '2026-10-31', payment_status: 'paid' as const };
const octoberAnalytics = { start_date: october.date_from, end_date: october.date_to };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
  vi.clearAllMocks();
  db.appointments.count.mockResolvedValue(0);
  db.appointments.findMany.mockResolvedValue([]);
  db.customers.count.mockResolvedValue(0);
  db.staff.count.mockResolvedValue(0);
  db.staff.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([{ count: 0 }]);
  db.transactions.findMany.mockImplementation(async ({ where, skip = 0, take = rows.length }) =>
    rows.filter((r) => matches(r, where)).slice(skip, skip + take));
  db.transactions.count.mockImplementation(async ({ where }) => rows.filter((r) => matches(r, where)).length);
  db.transactions.aggregate.mockImplementation(async ({ where }) => ({
    _sum: { total_amount: rows.filter((r) => matches(r, where)).reduce((sum, r) => sum + r.total_amount, 0) },
  }));
  db.transactions.groupBy.mockImplementation(async ({ where }) => {
    const groups = new Map<string, any>();
    for (const row of rows.filter((r) => matches(r, where))) {
      const key = `${row.type}:${row.payment_status}`;
      const group = groups.get(key) ?? {
        type: row.type, payment_status: row.payment_status,
        _sum: { total_amount: 0, discount_amount: 0, tax_amount: 0 }, _count: { _all: 0 },
      };
      group._sum.total_amount += row.total_amount;
      group._count._all++;
      groups.set(key, group);
    }
    return [...groups.values()];
  });
});

afterEach(() => vi.useRealTimers());

describe('monthly dashboard and paid transaction reconciliation', () => {
  it('matches the full filtered list and export, including when the list is paginated', async () => {
    const dashboard = await analyticsService.getDashboard();
    const list = await transactionService.getTransactions({ ...october, limit: '1', page: '1' });
    const report = await transactionService.getTransactionReport(october);
    // 1000 + 200 + 300 + 500 - 100; pending/voided/deleted and other months excluded.
    expect(dashboard.total_revenue).toBe(1900);
    expect(list.summary.net_revenue).toBe(1900);
    expect(report.summary.net_revenue).toBe(1900);
    expect(list.data).toHaveLength(1);
    expect(report.rows.map((r) => r.id)).toEqual([1, 3, 4, 7, 11]);
  });

  it('uses the same visit dates and Manila day buckets for the revenue chart and export', async () => {
    const revenue = await analyticsService.getRevenue({ ...octoberAnalytics, group_by: 'day' });
    const report = await transactionService.getTransactionReport(october);
    expect(revenue.data).toEqual([
      { date: '2026-10-01', revenue: 1200 },
      { date: '2026-10-20', revenue: -100 },
      { date: '2026-10-31', revenue: 800 },
    ]);
    expect(revenue.data).toEqual(report.by_day.map((d) => ({ date: d.key, revenue: d.amount })));
  });

  it('keeps analytics summary revenue and transaction count consistent with paid October rows', async () => {
    const summary = await analyticsService.getSummary(octoberAnalytics);
    expect(summary.total_revenue).toBe(1900);
    expect(summary.transaction_count).toBe(5);
    expect(summary.occupancy.series).toHaveLength(31);
    expect(summary.occupancy.series[0].date).toBe('2026-10-01');
    expect(summary.occupancy.series[30].date).toBe('2026-10-31');
  });

  it('does not let a matching search term bypass the October date filter', async () => {
    const report = await transactionService.getTransactionReport({ ...october, search: 'TXN-2' });
    expect(report.rows).toHaveLength(0);
    expect(report.summary.net_revenue).toBe(0);
  });

  it('groups by the reporting month rather than the record creation month', async () => {
    const revenue = await analyticsService.getRevenue({ ...octoberAnalytics, group_by: 'month' });
    expect(revenue.data).toEqual([{ date: '2026-10', revenue: 1900 }]);
  });

  it('uses calendar weeks consistently for appointment and standalone payments', async () => {
    const revenue = await analyticsService.getRevenue({ ...octoberAnalytics, group_by: 'week' });
    expect(revenue.data).toEqual([
      { date: '2026-09-27', revenue: 1200 },
      { date: '2026-10-18', revenue: -100 },
      { date: '2026-10-25', revenue: 800 },
    ]);
  });

  it('switches the dashboard month at midnight in Manila, even on a UTC host', async () => {
    vi.setSystemTime(new Date('2026-10-31T16:00:00Z'));
    const dashboard = await analyticsService.getDashboard();
    const report = await transactionService.getTransactionReport({
      date_from: '2026-11-01', date_to: '2026-11-30', payment_status: 'paid',
    });
    expect(dashboard.total_revenue).toBe(8000);
    expect(dashboard.total_revenue).toBe(report.summary.net_revenue);
  });

  it('resolves year rollover and leap-year month ends in the clinic timezone', () => {
    expect(clinicMonthRange(new Date('2026-12-31T16:00:00Z'))).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(clinicMonthRange(new Date('2028-02-15T00:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

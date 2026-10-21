import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Activity, AlertTriangle, CalendarCheck, CheckCircle2,
  DollarSign, Package, Sparkles, TrendingUp, UserCheck, Users,
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import dayjs from 'dayjs';
import { analyticsApi, appointmentsApi } from '@/api';
import { useAuth } from '@/context/AuthContext';
import KpiCard from '@/components/analytics/KpiCard';
import ChartCard from '@/components/analytics/ChartCard';
import DeltaBadge from '@/components/analytics/DeltaBadge';
import Reveal from '@/components/ui/Reveal';
import Skeleton, { SkeletonBlock, KpiSkeleton } from '@/components/ui/Skeleton';
import { formatCurrency, formatNumber, formatPercent, percentChange } from '@/utils/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

interface DashboardData {
  total_appointments: number;
  completed: number;
  cancelled: number;
  no_show: number;
  total_revenue: number;
  total_customers: number;
  total_staff: number;
  low_stock_count: number;
}

interface RevenueData { date: string; revenue: number; }

interface AppointmentData {
  date: string;
  total: number;
  completed: number;
  cancelled: number;
  no_show: number;
  pending: number;
}

interface ServiceData { name: string; appointment_count: number; }

interface OccupancySummary {
  rate: number;
  working_minutes: number;
  booked_minutes: number;
  unbooked_minutes: number;
  series: { date: string; rate: number }[];
}

interface SummaryData {
  transaction_count: number;
  total_revenue: number;
  avg_sale: number;
  occupancy: OccupancySummary;
  returning_patient_rate: number;
  patients: { active: number; new_patients: number; returning_patients: number };
}

interface TodayAppt {
  id: number;
  start_time: string;
  end_time: string;
  status: string;
  customer: { first_name: string; last_name: string } | null;
  service: { name: string } | null;
  services?: { name: string }[];
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  completed: { color: '#16a34a', label: 'Completed' },
  cancelled: { color: '#ef4444', label: 'Cancelled' },
  no_show: { color: '#dc2626', label: 'No-show' },
  pending: { color: '#f59e0b', label: 'Pending' },
  confirmed: { color: '#2563eb', label: 'Confirmed' },
  checked_in: { color: '#0d9488', label: 'Checked in' },
  in_progress: { color: '#7c3aed', label: 'In progress' },
};

const DOUGHNUT_COLORS = [
  '#bb8875', '#82574b', '#e0b3a3', '#a3a3a3', '#624139',
  '#eccdc2', '#525252', '#d09a87', '#404040', '#452d28',
];

const TODAY_PANEL_STATES = ['pending', 'confirmed', 'checked_in', 'in_progress'];

function prevRange(from: string, to: string): { from: string; to: string } {
  const start = dayjs(from);
  const end = dayjs(to);
  const len = end.diff(start, 'day') + 1;
  const prevTo = start.subtract(1, 'day');
  return { from: prevTo.subtract(len - 1, 'day').format('YYYY-MM-DD'), to: prevTo.format('YYYY-MM-DD') };
}

function resolveData<T>(result: PromiseSettledResult<any>, path: (data: any) => T): T {
  return result.status === 'fulfilled' ? path(result.value.data.data) : null as unknown as T;
}

const serviceLabel = (a: TodayAppt) =>
  a.services && a.services.length > 0 ? a.services.map((s) => s.name).join(', ') : a.service?.name || '';

export default function Dashboard() {
  const { user } = useAuth();
  const [monthly, setMonthly] = useState<DashboardData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [prevRevenueData, setPrevRevenueData] = useState<RevenueData[]>([]);
  const [appointmentData, setAppointmentData] = useState<AppointmentData[]>([]);
  const [prevAppointmentData, setPrevAppointmentData] = useState<AppointmentData[]>([]);
  const [serviceData, setServiceData] = useState<ServiceData[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [prevSummary, setPrevSummary] = useState<SummaryData | null>(null);
  const [todayAppts, setTodayAppts] = useState<TodayAppt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const today = dayjs();
      const dateFrom = today.subtract(29, 'day').format('YYYY-MM-DD');
      const dateTo = today.format('YYYY-MM-DD');
      const prev = prevRange(dateFrom, dateTo);
      const todayStr = today.format('YYYY-MM-DD');

      const jobs = [
        analyticsApi.getDashboard(),
        analyticsApi.getRevenue({ start_date: dateFrom, end_date: dateTo, group_by: 'day' }),
        analyticsApi.getRevenue({ start_date: prev.from, end_date: prev.to, group_by: 'day' }),
        analyticsApi.getAppointments({ start_date: dateFrom, end_date: dateTo }),
        analyticsApi.getAppointments({ start_date: prev.from, end_date: prev.to }),
        analyticsApi.getServices(),
        analyticsApi.getSummary({ start_date: dateFrom, end_date: dateTo }),
        analyticsApi.getSummary({ start_date: prev.from, end_date: prev.to }),
        appointmentsApi.list({ date_from: todayStr, date_to: todayStr }),
      ];
      const [dash, rev, prevRev, apt, prevApt, svc, sum, prevSum, todayRes] = await Promise.allSettled(jobs);

      setMonthly(resolveData<DashboardData>(dash, (d) => d));
      setRevenueData(resolveData<RevenueData[]>(rev, (d) => d.data) || []);
      setPrevRevenueData(resolveData<RevenueData[]>(prevRev, (d) => d.data) || []);
      setAppointmentData(resolveData<AppointmentData[]>(apt, (d) => d) || []);
      setPrevAppointmentData(resolveData<AppointmentData[]>(prevApt, (d) => d) || []);
      setServiceData(resolveData<ServiceData[]>(svc, (d) => d) || []);
      setSummary(resolveData<SummaryData>(sum, (d) => d));
      setPrevSummary(resolveData<SummaryData>(prevSum, (d) => d));
      setTodayAppts(resolveToday(todayRes));
    } catch {
      setError('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  const resolveToday = (result: PromiseSettledResult<any>): TodayAppt[] => {
    if (result.status !== 'fulfilled') return [];
    const list = result.value.data.data;
    if (!Array.isArray(list)) return [];
    const active = list.filter((a: any) => TODAY_PANEL_STATES.includes(a.status));
    return active.sort((a: any, b: any) => String(a.start_time).localeCompare(String(b.start_time)));
  };

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const revenueTotal = revenueData.reduce((s, d) => s + Number(d.revenue), 0);
  const prevRevenueTotal = prevRevenueData.reduce((s, d) => s + Number(d.revenue), 0);
  const revenueDelta = percentChange(revenueTotal, prevRevenueTotal);

  const appointmentTotal = appointmentData.reduce((s, d) => s + Number(d.total), 0);
  const prevAppointmentTotal = prevAppointmentData.reduce((s, d) => s + Number(d.total), 0);
  const appointmentDelta = percentChange(appointmentTotal, prevAppointmentTotal);

  const avgSaleDelta = percentChange(summary?.avg_sale ?? 0, prevSummary?.avg_sale ?? 0);
  const occupancyDelta = prevSummary?.occupancy !== undefined
    ? Math.round(((summary?.occupancy.rate ?? 0) - (prevSummary?.occupancy.rate ?? 0)) * 10) / 10
    : null;
  const returningDelta = prevSummary?.returning_patient_rate !== undefined
    ? Math.round(((summary?.returning_patient_rate ?? 0) - (prevSummary?.returning_patient_rate ?? 0)) * 10) / 10
    : null;

  const statusAccum: Record<string, number> = {};
  for (const d of appointmentData) {
    for (const key of Object.keys(STATUS_META)) {
      const v = (d as any)[key];
      if (v) statusAccum[key] = (statusAccum[key] || 0) + v;
    }
  }
  const statusData = Object.entries(statusAccum).map(([status, count]) => ({ status, count }));
  const statusTotal = statusData.reduce((s, d) => s + d.count, 0);

  const prevRevenueSeries = revenueData.map((d) => {
    const match = prevRevenueData.find((p) => p.date === d.date);
    return match?.revenue ?? 0;
  });

  const baseTooltip = (prefix?: string) => ({
    backgroundColor: '#1c1a15',
    titleColor: '#e9e2d3',
    bodyColor: '#ffffff',
    padding: 12,
    cornerRadius: 4,
    titleFont: { family: 'Inter, sans-serif', size: 12 },
    bodyFont: { family: 'Inter, sans-serif', size: 13, weight: 'bold' as const },
  });

  const revenueLineData = {
    labels: revenueData.map((d) => dayjs(d.date).format('MMM D')),
    datasets: [
      { label: 'Current', data: revenueData.map((d) => d.revenue), borderColor: '#94733f', backgroundColor: 'rgba(148, 115, 63, 0.10)', fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5 },
      { label: 'Previous', data: prevRevenueSeries, borderColor: '#b8ad97', backgroundColor: 'transparent', borderDash: [5, 4], tension: 0.4, pointRadius: 0, fill: false },
    ],
  };

  const revenueOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { position: 'top' as const, labels: { boxWidth: 12, usePointStyle: true, font: { family: 'Inter, sans-serif', size: 11 } } },
      tooltip: {
        ...baseTooltip(),
        callbacks: { label: (c: any) => `${c.dataset.label}: ${formatCurrency(Number(c.raw))}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { family: 'Inter, sans-serif', size: 11 } } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family: 'Inter, sans-serif', size: 11 }, callback: (v: any) => `₱${Number(v).toLocaleString()}` } },
    },
  };

  const appointmentLineData = {
    labels: appointmentData.map((d) => dayjs(d.date).format('MMM D')),
    datasets: [
      { label: 'Current', data: appointmentData.map((d) => d.total), borderColor: '#bb8875', backgroundColor: 'rgba(187, 136, 117, 0.10)', fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5 },
      { label: 'Previous', data: appointmentData.map((d) => prevAppointmentData.find((p) => p.date === d.date)?.total ?? 0), borderColor: '#b8ad97', backgroundColor: 'transparent', borderDash: [5, 4], tension: 0.4, pointRadius: 0, fill: false },
    ],
  };

  const appointmentOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { position: 'top' as const, labels: { boxWidth: 12, usePointStyle: true, font: { family: 'Inter, sans-serif', size: 11 } } },
      tooltip: {
        ...baseTooltip(),
        callbacks: { label: (c: any) => `${c.dataset.label}: ${formatNumber(Number(c.raw))} appointment${Number(c.raw) === 1 ? '' : 's'}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { family: 'Inter, sans-serif', size: 11 } } },
      y: { beginAtZero: true, ticks: { precision: 0, font: { family: 'Inter, sans-serif', size: 11 } } },
    },
  };

  const DoughnutChart = (
    <div className="h-64">
      {serviceData.length > 0 ? (
        <Doughnut
          data={{
            labels: serviceData.slice(0, 8).map((d) => d.name),
            datasets: [{ data: serviceData.slice(0, 8).map((d) => d.appointment_count), backgroundColor: DOUGHNUT_COLORS, borderWidth: 2, borderColor: '#ffffff' }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
              legend: { position: 'bottom' as const, labels: { padding: 10, usePointStyle: true, boxWidth: 8, font: { family: 'Inter, sans-serif', size: 11 } } },
              tooltip: { ...baseTooltip(), callbacks: { label: (c: any) => ` ${c.label}: ${formatNumber(Number(c.raw))}` } },
            },
          }}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-neutral-400">No service data yet</div>
      )}
    </div>
  );

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greetingName = user?.staff?.first_name || 'Administrator';

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <Skeleton className="w-40 h-3" />
            <Skeleton className="w-64 h-8" />
          </div>
          <Skeleton className="w-32 h-4" />
        </div>
        <KpiSkeleton />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 card"><SkeletonBlock rows={8} /></div>
          <div className="card"><SkeletonBlock rows={8} /></div>
        </div>
      </div>
    );
  }
  if (error && !monthly) return <div className="text-center py-20 text-red-600">{error}</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">{dayjs().format('dddd, MMMM D, YYYY')}</p>
          <h1 className="text-2xl font-sans font-semibold text-neutral-900">
            {timeGreeting}, {greetingName}
          </h1>
        </div>
        <Link to="/admin/analytics" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-900 transition">
          View full analytics
          <ArrowRight size={16} />
        </Link>
      </div>

      {/* KPI row — this month */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { icon: <DollarSign size={20} />, iconBg: 'bg-yellow-50 text-yellow-600', label: 'Revenue (This Month)', body: formatCurrency(monthly?.total_revenue ?? 0), iconWrap: 'relative overflow-hidden' },
          { icon: <CalendarCheck size={20} />, iconBg: 'bg-blue-50 text-primary-700', label: 'Appointments (This Month)', body: formatNumber(monthly?.total_appointments ?? 0), extra: formatNumber(monthly?.completed ?? 0), extraSuffix: ' completed' },
          { icon: <Users size={20} />, iconBg: 'bg-purple-50 text-primary-700', label: 'Customers', body: formatNumber(monthly?.total_customers ?? 0) },
          { icon: <AlertTriangle size={20} />, iconBg: 'bg-red-50 text-red-600', label: 'Low Stock Alerts', body: formatNumber(monthly?.low_stock_count ?? 0) },
        ].map((k, i) => (
          <Reveal key={k.label} delay={Math.min(i * 60, 180)} className="h-full">
            <div className={`card shadow-sm h-full ${k.iconWrap ?? ''}`}>
              <div className={`p-3 rounded-md ${k.iconBg} w-fit`}>{k.icon}</div>
              {/* Fixed label height: a longer label wrapping to two lines must not
                  make one card taller than its neighbours in the row. */}
              <p className="text-xs text-neutral-500 font-medium mt-3 h-4 truncate">{k.label}</p>
              <p className="num text-3xl text-neutral-900 mt-1 truncate">
                {k.body}
                {k.extra !== undefined && (
                  <span className="text-xs font-sans font-medium text-neutral-500 ml-2 align-middle">
                    <span className="num text-green-600">{k.extra}</span>
                    {k.extraSuffix}
                  </span>
                )}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      {/* Sales + top services */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <ChartCard
            icon={TrendingUp}
            title="Sales — Revenue Over Time"
            subtitle="Last 30 days vs previous 30 days"
            right={<DeltaBadge value={revenueDelta} label="vs previous 30 days" />}
          >
            <div className="h-72">
              {revenueData.length > 0 ? (
                <Line data={revenueLineData} options={revenueOptions as any} />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-neutral-400">No sales data for this period</div>
              )}
            </div>
          </ChartCard>
        </div>
        <ChartCard icon={Sparkles} title="Top Services" subtitle="By appointment count">
          {DoughnutChart}
        </ChartCard>
      </div>

      {/* Appointment trends */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-3">
          <ChartCard
            icon={CalendarCheck}
            title="Appointment Trends"
            subtitle={`${formatNumber(appointmentTotal)} appointments in the last 30 days · ${statusTotal > 0 ? `${statusTotal} status-tracked` : 'no bookings'}`}
            right={
              statusTotal > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {statusData.map((s) => (
                    <span
                      key={s.status}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
                      style={{ backgroundColor: `${STATUS_META[s.status]?.color || '#a3a3a3'}15`, color: STATUS_META[s.status]?.color || '#a3a3a3' }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_META[s.status]?.color || '#a3a3a3' }} />
                      {STATUS_META[s.status]?.label || s.status}: <span className="num">{s.count}</span>
                    </span>
                  ))}
                </div>
              ) : null
            }
          >
            <div className="h-72">
              {appointmentData.length > 0 ? (
                <Line data={appointmentLineData} options={appointmentOptions as any} />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-neutral-400">No appointment data for this period</div>
              )}
            </div>
          </ChartCard>
        </div>
      </div>

      {/* KPI insights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard label="Avg Sale" value={formatCurrency(summary?.avg_sale ?? 0)} icon={DollarSign} iconClassName="bg-yellow-50 text-yellow-600" delta={avgSaleDelta} deltaLabel="vs prev 30 days" />
          <KpiCard label="Occupancy" value={formatPercent(summary?.occupancy.rate ?? 0)} icon={Activity} iconClassName="bg-amber-50 text-amber-600" delta={occupancyDelta} deltaLabel="vs prev 30 days (pp)" />
          <KpiCard label="Returning Patients" value={formatPercent(summary?.returning_patient_rate ?? 0)} icon={UserCheck} iconClassName="bg-purple-50 text-purple-600" delta={returningDelta} deltaLabel="vs prev 30 days (pp)" />
          <KpiCard label="Appointments" value={formatNumber(appointmentTotal)} icon={CalendarCheck} iconClassName="bg-blue-50 text-blue-600" delta={appointmentDelta} deltaLabel="vs prev 30 days" />
        </div>

      {/* Today's schedule */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-md bg-neutral-100 text-neutral-700">
            <Package size={16} />
          </div>
          <div>
            <h2 className="font-semibold text-neutral-900">Today's Schedule</h2>
            <p className="text-xs text-neutral-400">{formatNumber(todayAppts.length)} active appointment{todayAppts.length === 1 ? '' : 's'} · {dayjs().format('MMMM D, YYYY')}</p>
          </div>
        </div>
        {todayAppts.length > 0 ? (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="py-2.5 text-left text-neutral-500 font-medium">Time</th>
                  <th className="py-2.5 text-left text-neutral-500 font-medium">Customer</th>
                  <th className="py-2.5 text-left text-neutral-500 font-medium">Service</th>
                  <th className="py-2.5 text-right text-neutral-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {todayAppts.map((a) => (
                  <tr key={a.id} className="hover:bg-neutral-50/60">
                    <td className="py-3 num text-neutral-900 whitespace-nowrap">
                      {a.start_time} — {a.end_time}
                    </td>
                    <td className="py-3 text-neutral-900 font-medium">
                      {a.customer ? `${a.customer.first_name} ${a.customer.last_name}` : 'Walk-in'}
                    </td>
                    <td className="py-3 text-neutral-600">{serviceLabel(a) || '—'}</td>
                    <td className="py-3 text-right">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
                        style={{ backgroundColor: `${STATUS_META[a.status]?.color || '#a3a3a3'}15`, color: STATUS_META[a.status]?.color || '#a3a3a3' }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_META[a.status]?.color || '#a3a3a3' }} />
                        {STATUS_META[a.status]?.label || a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center py-10 text-sm text-neutral-400">
            No active appointments scheduled for today
          </div>
        )}
      </div>
    </div>
  );
}
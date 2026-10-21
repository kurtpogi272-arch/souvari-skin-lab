import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  ClipboardList,
  CheckCircle,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useAuth } from '@/context/AuthContext';
import { appointmentsApi } from '@/api';
import StatusBadge from '@/components/ui/StatusBadge';
import Reveal from '@/components/ui/Reveal';
import Skeleton, { SkeletonBlock } from '@/components/ui/Skeleton';

interface Appointment {
  id: number;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
  customer: { first_name: string; last_name: string } | null;
  service: { name: string } | null;
  services?: { name: string }[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTodayAppointments();
  }, []);

  const fetchTodayAppointments = async () => {
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const params: Record<string, string> = { date_from: today, date_to: today };
      if (user?.staff?.id) params.staff_id = String(user.staff.id);
      const { data } = await appointmentsApi.list(params);
      setAppointments(data.data || []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const todayCount = appointments.length;
  const pendingCount = appointments.filter((a) => a.status === 'pending').length;
  const confirmedCount = appointments.filter((a) => a.status === 'confirmed').length;
  const completedCount = appointments.filter((a) => a.status === 'completed').length;

  const firstName = user?.staff?.first_name || 'Staff';

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="w-48 h-7" />
          <Skeleton className="w-72 h-4 mt-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <div key={i} className="card"><Skeleton className="w-12 h-12 rounded-md" /><Skeleton className="w-32 h-3 mt-4" /><Skeleton className="w-24 h-4 mt-2" /></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card"><Skeleton className="w-40 h-5 mb-4" /><SkeletonBlock rows={6} /></div>
          <div className="card"><Skeleton className="w-40 h-5 mb-4" /><SkeletonBlock rows={6} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-sans font-semibold text-neutral-900">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Here's your schedule for {dayjs().format('MMMM D, YYYY')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <CalendarDays className="h-6 w-6 text-primary-600" />, iconBg: 'bg-primary-100', count: todayCount, label: "Today's Appointments" },
          { icon: <Clock className="h-6 w-6 text-yellow-600" />, iconBg: 'bg-yellow-100', count: pendingCount, label: 'Pending' },
          { icon: <ClipboardList className="h-6 w-6 text-primary-700" />, iconBg: 'bg-primary-100', count: confirmedCount, label: 'Confirmed' },
          { icon: <CheckCircle className="h-6 w-6 text-green-600" />, iconBg: 'bg-green-100', count: completedCount, label: 'Completed' },
        ].map((k, i) => (
          <Reveal key={k.label} delay={Math.min(i * 60, 180)}>
            <div className="card flex items-center gap-4">
              <div className={`p-3 ${k.iconBg} rounded-md`}>{k.icon}</div>
              <div>
                <p className="text-2xl font-sans font-semibold text-neutral-900">{k.count}</p>
                <p className="text-xs text-neutral-500">{k.label}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">Today's Schedule</h2>
              <Link to="/staff/appointments" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                View all <ArrowRight size={14} />
              </Link>
            </div>
            {appointments.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <AlertCircle className="h-10 w-10 text-neutral-300 mb-2" />
                <p className="text-sm text-neutral-500">No appointments scheduled for today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appointments.map((appt) => (
                  <div
                    key={appt.id}
                    className="flex items-center gap-4 p-3 rounded-md border border-neutral-100 hover:bg-neutral-50 transition"
                  >
                    <div className="text-center min-w-[60px]">
                      <p className="text-sm font-semibold text-neutral-900">
                        {dayjs(`2000-01-01 ${appt.start_time}`).format('h:mm A')}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-900 truncate">
                        {appt.customer
                          ? `${appt.customer.first_name} ${appt.customer.last_name}`
                          : 'Unknown Customer'}
                      </p>
                      <p className="text-xs text-neutral-500 truncate">
                        {appt.service?.name || 'Unknown Service'}
                        {appt.services && appt.services.length > 1 ? ` +${appt.services.length - 1}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={appt.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Link
                to="/staff/appointments"
                className="flex items-center gap-3 p-3 rounded-md border border-neutral-200 hover:bg-primary-50 hover:border-primary-200 transition"
              >
                <ClipboardList size={18} className="text-primary-600" />
                <span className="text-sm font-medium text-neutral-700">Manage Appointments</span>
              </Link>
              <Link
                to="/staff/schedule"
                className="flex items-center gap-3 p-3 rounded-md border border-neutral-200 hover:bg-primary-50 hover:border-primary-200 transition"
              >
                <CalendarDays size={18} className="text-primary-600" />
                <span className="text-sm font-medium text-neutral-700">View My Schedule</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

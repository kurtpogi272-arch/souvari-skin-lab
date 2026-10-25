import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext';
import PublicLayout from './components/layout/PublicLayout';
import DashboardLayout from './components/layout/DashboardLayout';
import LoadingSpinner from './components/shared/LoadingSpinner';
import ScrollToTop from './components/ScrollToTop';

const Home = lazy(() => import('./pages/public/Home'));
const About = lazy(() => import('./pages/public/About'));
const PublicServices = lazy(() => import('./pages/public/PublicServices'));
const ServiceDetail = lazy(() => import('./pages/public/ServiceDetail'));
const Contact = lazy(() => import('./pages/public/Contact'));
const BookingPage = lazy(() => import('./pages/public/BookingPage'));
const BookingConfirmation = lazy(() => import('./pages/public/BookingConfirmation'));
const MembershipPlans = lazy(() => import('./pages/public/MembershipPlans'));
const Login = lazy(() => import('./pages/auth/Login'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const Register = lazy(() => import('./pages/auth/Register'));

const CustomerDashboard = lazy(() => import('./pages/customer/Dashboard'));
const CustomerAppointments = lazy(() => import('./pages/customer/Appointments'));
const CustomerTransactions = lazy(() => import('./pages/customer/Transactions'));
const CustomerNotifications = lazy(() => import('./pages/customer/Notifications'));
const CustomerProfile = lazy(() => import('./pages/customer/Profile'));
const CustomerChatbot = lazy(() => import('./pages/customer/Chatbot'));
const CustomerMembership = lazy(() => import('./pages/customer/Membership'));

const StaffDashboard = lazy(() => import('./pages/staff/Dashboard'));
const StaffAppointments = lazy(() => import('./pages/staff/Appointments'));
const StaffSchedule = lazy(() => import('./pages/staff/Schedule'));
const StaffNotifications = lazy(() => import('./pages/staff/Notifications'));
const StaffProducts = lazy(() => import('./pages/staff/Products'));

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminCustomers = lazy(() => import('./pages/admin/Customers'));
const AdminStaff = lazy(() => import('./pages/admin/Staff'));
const AdminShifts = lazy(() => import('./pages/admin/Shifts'));
const AdminServices = lazy(() => import('./pages/admin/Services'));
const AdminNewService = lazy(() => import('./pages/admin/NewService'));
const AdminProducts = lazy(() => import('./pages/admin/Products'));
const AdminInventory = lazy(() => import('./pages/admin/Inventory'));
const AdminAppointments = lazy(() => import('./pages/admin/Appointments'));
const AdminCalendar = lazy(() => import('./pages/admin/Calendar'));
const AdminTransactions = lazy(() => import('./pages/admin/Transactions'));
const AdminAnalytics = lazy(() => import('./pages/admin/Analytics'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminMembershipPlans = lazy(() => import('./pages/admin/MembershipPlans'));
const AdminMemberships = lazy(() => import('./pages/admin/Memberships'));
const AdminPackages = lazy(() => import('./pages/admin/Packages'));
const AdminNotifications = lazy(() => import('./pages/admin/Notifications'));
const AdminReviews = lazy(() => import('./pages/admin/Reviews'));

import NotFound from './pages/errors/NotFound';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;

  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<LoadingSpinner fullScreen />}>
      <Routes>
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/services" element={<PublicServices />} />
        <Route path="/services/:id" element={<ServiceDetail />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/booking" element={<BookingPage />} />
        <Route path="/booking/confirmation" element={<BookingConfirmation />} />
        <Route path="/membership-plans" element={<MembershipPlans />} />
      </Route>

      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/register" element={<Register />} />

      {/* Customer */}
      <Route path="/customer" element={<ProtectedRoute allowedRoles={['customer']}><DashboardLayout role="customer" /></ProtectedRoute>}>
        <Route index element={<CustomerDashboard />} />
        <Route path="appointments" element={<CustomerAppointments />} />
        <Route path="book" element={<BookingPage embedded />} />
        <Route path="transactions" element={<CustomerTransactions />} />
        <Route path="notifications" element={<CustomerNotifications />} />
        <Route path="profile" element={<CustomerProfile />} />
        <Route path="chat" element={<CustomerChatbot />} />
        <Route path="membership" element={<CustomerMembership />} />
      </Route>

      {/* Staff */}
      <Route path="/staff" element={<ProtectedRoute allowedRoles={['staff']}><DashboardLayout role="staff" /></ProtectedRoute>}>
        <Route index element={<StaffDashboard />} />
        <Route path="appointments" element={<StaffAppointments />} />
        <Route path="calendar" element={<AdminCalendar />} />
        <Route path="schedule" element={<StaffSchedule />} />
        <Route path="products" element={<StaffProducts />} />
        <Route path="notifications" element={<StaffNotifications />} />
      </Route>

      {/* Admin */}
      <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><DashboardLayout role="admin" /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="staff" element={<AdminStaff />} />
        <Route path="shifts" element={<AdminShifts />} />
        <Route path="services" element={<AdminServices />} />
        <Route path="services/new" element={<AdminNewService />} />
        <Route path="services/:id/edit" element={<AdminNewService />} />
        <Route path="products" element={<AdminProducts />} />
        <Route path="inventory" element={<AdminInventory />} />
        <Route path="appointments" element={<AdminAppointments />} />
        <Route path="calendar" element={<AdminCalendar />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="reviews" element={<AdminReviews />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="membership-plans" element={<AdminMembershipPlans />} />
        <Route path="memberships" element={<AdminMemberships />} />
        <Route path="packages" element={<AdminPackages />} />
        <Route path="notifications" element={<AdminNotifications />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </>
  );
}

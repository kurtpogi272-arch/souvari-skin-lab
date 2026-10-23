import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import PublicLayout from './components/layout/PublicLayout';
import DashboardLayout from './components/layout/DashboardLayout';
import LoadingSpinner from './components/shared/LoadingSpinner';
import ScrollToTop from './components/ScrollToTop';

import Home from './pages/public/Home';
import About from './pages/public/About';
import PublicServices from './pages/public/PublicServices';
import ServiceDetail from './pages/public/ServiceDetail';
import Contact from './pages/public/Contact';
import BookingPage from './pages/public/BookingPage';
import BookingConfirmation from './pages/public/BookingConfirmation';
import MembershipPlans from './pages/public/MembershipPlans';
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import Register from './pages/auth/Register';

import CustomerDashboard from './pages/customer/Dashboard';
import CustomerAppointments from './pages/customer/Appointments';
import CustomerTransactions from './pages/customer/Transactions';
import CustomerNotifications from './pages/customer/Notifications';
import CustomerProfile from './pages/customer/Profile';
import CustomerChatbot from './pages/customer/Chatbot';
import CustomerMembership from './pages/customer/Membership';

import StaffDashboard from './pages/staff/Dashboard';
import StaffAppointments from './pages/staff/Appointments';
import StaffSchedule from './pages/staff/Schedule';
import StaffNotifications from './pages/staff/Notifications';
import StaffProducts from './pages/staff/Products';

import AdminDashboard from './pages/admin/Dashboard';
import AdminCustomers from './pages/admin/Customers';
import AdminStaff from './pages/admin/Staff';
import AdminShifts from './pages/admin/Shifts';
import AdminServices from './pages/admin/Services';
import AdminNewService from './pages/admin/NewService';
import AdminProducts from './pages/admin/Products';
import AdminInventory from './pages/admin/Inventory';
import AdminAppointments from './pages/admin/Appointments';
import AdminCalendar from './pages/admin/Calendar';
import AdminTransactions from './pages/admin/Transactions';
import AdminAnalytics from './pages/admin/Analytics';
import AdminSettings from './pages/admin/Settings';
import AdminMembershipPlans from './pages/admin/MembershipPlans';
import AdminMemberships from './pages/admin/Memberships';
import AdminPackages from './pages/admin/Packages';
import AdminNotifications from './pages/admin/Notifications';
import AdminReviews from './pages/admin/Reviews';

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
    </>
  );
}

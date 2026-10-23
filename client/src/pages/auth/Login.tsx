import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import ChatbotWidget from '../../components/chatbot/ChatbotWidget';

interface LoginForm {
  email: string;
  password: string;
}

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>();

  const defaultDestination = (role: string) =>
    role === 'admin' ? '/admin' : role === 'staff' ? '/staff' : '/customer';

  const onSubmit = async (values: LoginForm) => {
    try {
      const userData = await login(values.email, values.password);
      toast.success('Welcome back!');
      const isSafeRedirect =
        userData.role === 'customer' &&
        redirectTo &&
        redirectTo.startsWith('/') &&
        !redirectTo.startsWith('//');
      navigate(isSafeRedirect ? redirectTo : defaultDestination(userData.role), { replace: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Invalid email or password');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Simple top nav */}
      <div className="border-b border-neutral-800 bg-neutral-900">
        <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-center">
          <Link to="/" className="flex items-center">
            <img src="/images/souvari-logo.png" alt="Souvari Skin Lab" className="h-8 sm:h-9 w-auto object-contain" />
          </Link>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-neutral-200 p-8 md:p-10">
          <div className="text-center mb-8">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-primary-600">Sign in</p>
            <h1 className="mt-4 text-3xl font-sans font-semibold text-neutral-900">Welcome back</h1>
            <p className="text-sm text-neutral-500 mt-2">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input-field"
                placeholder=""
                {...register('email', { required: 'Email is required' })}
              />
              {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder="Enter your password"
                  {...register('password', { required: 'Password is required' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>}
              <div className="mt-2 text-right">
                <Link to="/forgot-password" className="text-sm text-primary-700 hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full mt-3">
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-neutral-500 mt-7">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-primary-700 font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>

      {/* Floating Chatbot */}
      <ChatbotWidget />
    </div>
  );
}

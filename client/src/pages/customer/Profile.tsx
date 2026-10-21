import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { User, Save, Phone, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { customersApi } from '@/api';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

interface ProfileForm {
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  address: string;
}

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ProfileForm>();

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data } = await customersApi.getMe();
        const c = data.data;
        reset({
          first_name: c.first_name || '',
          last_name: c.last_name || '',
          gender: c.gender || '',
          date_of_birth: c.date_of_birth ? c.date_of_birth.split('T')[0] : '',
          address: c.address || '',
        });
        setPhoneInput(c.user?.phone || c.phone || '');
        setEmailInput(c.user?.email || '');
      } catch {
        toast.error('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [reset]);

  const onSubmit = async (formData: ProfileForm) => {
    setSaving(true);
    try {
      await customersApi.updateMe(formData);
      await refreshUser();
      toast.success('Profile updated successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const onPhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneSaving(true);
    try {
      await customersApi.updateMe({ phone: phoneInput });
      await refreshUser();
      toast.success('Phone number updated successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update phone number');
    } finally {
      setPhoneSaving(false);
    }
  };

  const onEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = emailInput.trim();
    if (!next) {
      toast.error('Email cannot be empty');
      return;
    }
    setEmailSaving(true);
    try {
      // The server rejects an address already held by an admin or staff account,
      // so this can only ever move the customer's own login.
      await customersApi.updateMe({ email: next });
      await refreshUser();
      setEmailInput(next);
      toast.success('Email updated successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update email');
    } finally {
      setEmailSaving(false);
    }
  };

  if (loading) return <LoadingSpinner fullScreen />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-sans font-semibold text-neutral-900">My Profile</h1>

      <div className="card">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-neutral-100">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
            <User size={28} className="text-primary-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-neutral-900">{user?.customer?.first_name} {user?.customer?.last_name}</p>
            <p className="text-sm text-neutral-500">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={onPhoneSubmit} className="space-y-2">
          <label className="label">Phone Number</label>
          <input
            type="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            className="input-field"
            placeholder="+63 917 123 4567"
          />
          <button
            type="submit"
            disabled={phoneSaving}
            className="btn-primary mt-2"
          >
            <Phone size={16} />
            {phoneSaving ? 'Updating...' : 'Update Phone Number'}
          </button>
        </form>

        <form onSubmit={onEmailSubmit} className="space-y-2 mt-6">
          <label className="label">Email Address</label>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="input-field"
            placeholder="you@example.com"
          />
          <p className="text-xs text-neutral-400">
            This is also your sign-in address. It must not be one already used by a staff account.
          </p>
          <button
            type="submit"
            disabled={emailSaving || emailInput.trim() === (user?.email || '')}
            className="btn-primary mt-2"
          >
            <Mail size={16} />
            {emailSaving ? 'Updating...' : 'Update Email Address'}
          </button>
        </form>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-8 pt-6 border-t border-neutral-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="label">First Name</label>
              <input
                {...register('first_name', { required: 'First name is required' })}
                className="input-field"
              />
              {errors.first_name && <p className="text-xs text-red-500 mt-1">{errors.first_name.message}</p>}
            </div>
            <div>
              <label className="label">Last Name</label>
              <input
                {...register('last_name', { required: 'Last name is required' })}
                className="input-field"
              />
              {errors.last_name && <p className="text-xs text-red-500 mt-1">{errors.last_name.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="label">Gender</label>
              <select {...register('gender')} className="select-field">
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="label">Date of Birth</label>
              <input
                type="date"
                {...register('date_of_birth')}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label className="label">Address</label>
            <textarea
              {...register('address')}
              className="input-field"
              rows={3}
              placeholder="Your address"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="btn-primary"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
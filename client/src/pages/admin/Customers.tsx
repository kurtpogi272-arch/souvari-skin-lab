import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Search, Plus, Pencil, Trash2, Eye, EyeOff, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { customersApi } from '@/api';
import EmptyState from '@/components/shared/EmptyState';
import Pagination from '@/components/ui/Pagination';
import StatusBadge from '@/components/ui/StatusBadge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import Modal from '@/components/ui/Modal';
import CustomerDetailDrawer from '@/components/admin/CustomerDetailDrawer';

interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth?: string;
  address?: string;
  user?: { id: number; email: string; phone: string; status: string };
}

interface CustomerForm {
  first_name: string;
  last_name: string;
  email: string;
  password?: string;
  phone: string;
  gender: string;
  date_of_birth?: string;
  address?: string;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CustomerForm>();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '10' };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await customersApi.list(params);
      const result = data.data;
      setCustomers(result?.data || []);
      setTotalPages(result?.pagination?.totalPages || 1);
      setTotal(result?.pagination?.total || 0);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const openAddModal = () => {
    setEditingCustomer(null);
    setShowPassword(false);
    reset({ first_name: '', last_name: '', email: '', password: '', phone: '', gender: 'male', date_of_birth: '', address: '' });
    setModalOpen(true);
  };

  const openEditModal = (c: Customer) => {
    setEditingCustomer(c);
    setShowPassword(false);
    reset({
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.user?.email || '',
      phone: c.user?.phone || '',
      gender: c.gender || '',
      date_of_birth: c.date_of_birth || '',
      address: c.address || '',
    });
    setModalOpen(true);
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let pw = '';
    const random = crypto.getRandomValues(new Uint32Array(16));
    for (let i = 0; i < 12; i++) pw += chars[random[i] % chars.length];
    setValue('password', pw, { shouldValidate: true });
    setShowPassword(true);
  };

  const onSubmit = async (values: CustomerForm) => {
    setSubmitting(true);
    try {
      const { password, ...rest } = values;
      const payload = { ...rest };
      if (editingCustomer) {
        if (password?.trim()) (payload as CustomerForm).password = password.trim();
        await customersApi.update(editingCustomer.id, payload);
        toast.success('Customer updated');
      } else {
        await customersApi.create({ ...payload, password: password || 'password123' });
        toast.success('Customer created');
      }
      setModalOpen(false);
      fetchCustomers();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await customersApi.delete(deleteId);
      toast.success('Customer deleted');
      setDeleteId(null);
      fetchCustomers();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-sans font-semibold text-neutral-900">Customers</h1>
          <p className="text-sm text-neutral-500 mt-1">Manage your customer base</p>
        </div>
        <button onClick={openAddModal} className="btn-primary">
          <Plus size={18} />
          Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          className="input-field pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        {loading ? (
          <div className="px-6 py-8">
            <TableSkeleton rows={8} cols={6} />
          </div>
        ) : customers.length === 0 ? (
          <EmptyState title="No customers found" description="Try adjusting your search or add a new customer." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-neutral-500 bg-neutral-50/80 border-b border-neutral-200">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Name</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Email</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Phone</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Gender</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Status</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50/50">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => setSelectedCustomer(c)}
                        className="font-medium text-neutral-900 hover:text-primary-600 transition text-left"
                        title="View customer details"
                      >
                        {c.first_name} {c.last_name}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-neutral-600">{c.user?.email || '—'}</td>
                    <td className="px-6 py-4 text-neutral-600">{c.user?.phone || '—'}</td>
                    <td className="px-6 py-4 text-neutral-600 capitalize">{c.gender || '—'}</td>
                    <td className="px-6 py-4"><StatusBadge status={c.user?.status || 'active'} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditModal(c)} className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 rounded-md transition">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeleteId(c.id)} className="p-2 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-md transition">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && customers.length > 0 && (
          <div className="px-6 pb-4">
            <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingCustomer ? 'Edit Customer' : 'Add Customer'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">First Name</label>
              <input className="input-field" placeholder="First name" {...register('first_name', { required: 'Required' })} />
              {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name.message}</p>}
            </div>
            <div>
              <label className="label">Last Name</label>
              <input className="input-field" placeholder="Last name" {...register('last_name', { required: 'Required' })} />
              {errors.last_name && <p className="text-xs text-red-600 mt-1">{errors.last_name.message}</p>}
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input-field" placeholder="email@example.com" {...register('email', { required: 'Required' })} />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="label">{editingCustomer ? 'Reset Password (optional)' : 'Password'}</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder={editingCustomer ? 'Leave blank to keep current password' : 'Min. 8 characters'}
                  {...register('password', {
                    ...(editingCustomer
                      ? { minLength: { value: 8, message: 'Must be at least 8 characters' } }
                      : { required: 'Required', minLength: { value: 8, message: 'Must be at least 8 characters' } }),
                  })}
                />
                {watch('password') && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-700 transition"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={generatePassword}
                className="btn-secondary whitespace-nowrap"
                title="Generate a strong password"
              >
                <KeyRound size={15} /> Generate
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>}
            {editingCustomer && (
              <p className="text-xs text-neutral-400 mt-1">Setting a new password resets the customer's login credentials.</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Phone</label>
              <input className="input-field" placeholder="Phone number" {...register('phone')} />
            </div>
            <div>
              <label className="label">Gender</label>
              <select className="select-field" {...register('gender')}>
                <option value="">Not specified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Date of Birth</label>
            <input type="date" className="input-field" {...register('date_of_birth')} />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input-field" placeholder="Address" {...register('address')} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Saving...' : editingCustomer ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete Customer" maxWidth="max-w-sm">
        <p className="text-sm text-neutral-600 mb-6">
          Are you sure you want to delete this customer? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">Delete</button>
        </div>
      </Modal>

      {/* Customer Detail Drawer */}
      <CustomerDetailDrawer
        open={selectedCustomer !== null}
        onClose={() => setSelectedCustomer(null)}
        customer={selectedCustomer}
      />
    </div>
  );
}

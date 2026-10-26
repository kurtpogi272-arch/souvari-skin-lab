import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { AlertTriangle, ArrowUpDown, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { inventoryApi, productsApi } from '@/api';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import EmptyState from '@/components/shared/EmptyState';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import { registerMoney } from '@/utils/money';
import { inventoryMovementLabel } from '@/utils/inventoryMovement';

interface Movement {
  id: number;
  product: { id: number; name: string } | string;
  type: string;
  quantity: number;
  running_stock_after: number;
  performed_by: number;
  performed_by_user?: { id: number; email: string } | null;
  created_at: string;
  reason?: string;
  notes?: string | null;
}

interface LowStockProduct {
  id: number;
  name: string;
  current_stock: number;
  minimum_stock: number;
  unit: string;
  category_name: string;
}

interface Product {
  id: number;
  name: string;
  sku: string;
}

interface AdjustmentForm {
  product_id: number;
  adjustment_type: 'add' | 'deduct';
  quantity: number;
  reason: string;
}

interface PurchaseForm {
  product_id: number;
  quantity: number;
  unit_cost: number;
}

const TABS = ['Movements', 'Low Stock', 'Adjustments'] as const;

export default function Inventory() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('Movements');

  // Movements state
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(true);
  const [movementsPage, setMovementsPage] = useState(1);
  const [movementsTotalPages, setMovementsTotalPages] = useState(1);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [movementProductFilter, setMovementProductFilter] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('');
  const [movementDateFrom, setMovementDateFrom] = useState('');
  const [movementDateTo, setMovementDateTo] = useState('');

  // Low stock state
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);
  const [lowStockLoading, setLowStockLoading] = useState(true);

  // Products for dropdowns
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  // Adjustment modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  // Purchase modal
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);

  const { register: registerAdjust, handleSubmit: handleSubmitAdjust, reset: resetAdjust, watch: watchAdjust, formState: { errors: adjustErrors } } = useForm<AdjustmentForm>({
    defaultValues: { product_id: 0, adjustment_type: 'add', quantity: 1, reason: '' },
  });
  const addingStock = watchAdjust('adjustment_type') !== 'deduct';
  const stockAction = addingStock ? 'Add Stock' : 'Deduct Stock';
  const openAddStock = () => {
    resetAdjust({ product_id: 0, adjustment_type: 'add', quantity: 1, reason: '' });
    setAdjustModalOpen(true);
  };

  const { register: registerPurchase, handleSubmit: handleSubmitPurchase, reset: resetPurchase, formState: { errors: purchaseErrors } } = useForm<PurchaseForm>({
    defaultValues: { product_id: 0, quantity: 1, unit_cost: 0 },
  });

  const fetchMovements = useCallback(async () => {
    setMovementsLoading(true);
    try {
      const params: Record<string, string> = { page: String(movementsPage), limit: '15' };
      if (movementProductFilter) params.product_id = movementProductFilter;
      if (movementTypeFilter) params.type = movementTypeFilter;
      if (movementDateFrom) params.start_date = movementDateFrom;
      if (movementDateTo) params.end_date = movementDateTo;
      const { data } = await inventoryApi.list(params);
      setMovements(data.data || []);
      setMovementsTotalPages(data.pagination?.totalPages || 1);
      setMovementsTotal(data.pagination?.total || 0);
    } catch {
      toast.error('Failed to load movements');
    } finally {
      setMovementsLoading(false);
    }
  }, [movementsPage, movementProductFilter, movementTypeFilter, movementDateFrom, movementDateTo]);

  const fetchLowStock = useCallback(async () => {
    setLowStockLoading(true);
    try {
      const { data } = await inventoryApi.getLowStock();
      setLowStockProducts(data.data || []);
    } catch {
      toast.error('Failed to load low stock data');
    } finally {
      setLowStockLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await productsApi.list({ limit: '200' });
      setAllProducts(data.data || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchMovements(); }, [fetchMovements]);
  useEffect(() => { fetchLowStock(); }, [fetchLowStock]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { setMovementsPage(1); }, [movementProductFilter, movementTypeFilter, movementDateFrom, movementDateTo]);
  useEffect(() => { if (activeTab === 'Movements') fetchMovements(); }, [activeTab, fetchMovements]);

  const onAdjustSubmit = async (values: AdjustmentForm) => {
    setAdjustSubmitting(true);
    try {
      await inventoryApi.adjust(values);
      toast.success(values.adjustment_type === 'add' ? 'Stock added successfully' : 'Stock deducted successfully');
      setAdjustModalOpen(false);
      resetAdjust({ product_id: 0, adjustment_type: 'add', quantity: 1, reason: '' });
      fetchMovements();
      fetchLowStock();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Adjustment failed');
    } finally {
      setAdjustSubmitting(false);
    }
  };

  const onPurchaseSubmit = async (values: PurchaseForm) => {
    setPurchaseSubmitting(true);
    try {
      await inventoryApi.recordPurchase(values);
      toast.success('Purchase recorded successfully');
      setPurchaseModalOpen(false);
      resetPurchase({ product_id: 0, quantity: 1, unit_cost: 0 });
      fetchMovements();
      fetchLowStock();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Purchase recording failed');
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const getProductName = (product: Movement['product']) => {
    if (typeof product === 'string') return product;
    return product?.name || 'Unknown';
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      purchase: 'badge-success',
      adjustment: 'badge-info',
      sale: 'badge-warning',
      consumption: 'badge-warning',
      return: 'badge-info',
      damage: 'badge-danger',
      transfer: 'badge-neutral',
      opening_stock: 'badge-neutral',
    };
    return colors[type] || 'badge-neutral';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-sans font-semibold text-neutral-900">Inventory</h1>
          <p className="text-sm text-neutral-500 mt-1">Track stock movements and manage inventory</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAddStock} className="btn-primary">
            <ArrowUpDown size={18} />
            Add Stock
          </button>
          <button onClick={() => setPurchaseModalOpen(true)} className="btn-secondary">
            <Package size={18} />
            Record Purchase
          </button>
        </div>
      </div>

      {/* Low Stock Alert */}
      {!lowStockLoading && lowStockProducts.length > 0 && (
        <div className="card border-red-200 bg-red-50/50">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-red-500" />
            <h3 className="font-semibold text-red-700">Low Stock Alert</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {lowStockProducts.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-2 bg-white rounded-md border border-red-100">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{p.name}</p>
                  <p className="text-xs text-red-600">Stock: {p.current_stock} / Min: {p.minimum_stock} {p.unit}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === tab
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {tab}
            {tab === 'Low Stock' && lowStockProducts.length > 0 && (
              <span className="ml-1.5 bg-red-100 text-red-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                {lowStockProducts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Movements Tab */}
      {activeTab === 'Movements' && (
        <>
          <div className="card pb-0">
            <div className="flex flex-wrap items-end gap-3 pb-4">
              <div>
                <label className="label">Product</label>
                <select className="select-field w-full sm:w-auto" value={movementProductFilter} onChange={(e) => setMovementProductFilter(e.target.value)}>
                  <option value="">All Products</option>
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="select-field w-full sm:w-auto" value={movementTypeFilter} onChange={(e) => setMovementTypeFilter(e.target.value)}>
                  <option value="">All Types</option>
                  <option value="purchase">Purchase</option>
                  <option value="added_stock">Added Stock</option>
                  <option value="deducted_stock">Deducted Stock</option>
                  <option value="sale">Sale</option>
                  <option value="consumption">Consumption</option>
                  <option value="return">Return</option>
                  <option value="damage">Damage</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div>
                <label className="label">From</label>
                <input type="date" className="input-field w-auto" value={movementDateFrom} onChange={(e) => setMovementDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To</label>
                <input type="date" className="input-field w-auto" value={movementDateTo} onChange={(e) => setMovementDateTo(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card overflow-hidden !p-0">
            {movementsLoading ? (
              <LoadingSpinner fullScreen={false} />
            ) : movements.length === 0 ? (
              <EmptyState title="No movements found" description="Adjust your filters or record a new movement." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-neutral-500 bg-neutral-50/80 border-b border-neutral-200">
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Date</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Product</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Type</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Quantity</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Stock After</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Performed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-neutral-50/50">
                        <td className="px-6 py-4 text-neutral-600">
                          {dayjs(m.created_at).format('MMM D, YYYY h:mm A')}
                        </td>
                        <td className="px-6 py-4 font-medium text-neutral-900">{getProductName(m.product)}</td>
                        <td className="px-6 py-4">
                          <span className={`badge ${getTypeBadge(m.type)}`}>{inventoryMovementLabel(m.type, m.quantity)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`font-medium ${
                            m.quantity < 0 || m.type === 'sale' || m.type === 'consumption' || m.type === 'damage'
                              ? 'text-red-600'
                              : 'text-green-600'
                          }`}>
                            {m.quantity < 0 || m.type === 'sale' || m.type === 'consumption' || m.type === 'damage'
                              ? m.quantity < 0 ? m.quantity : `-${m.quantity}`
                              : `+${m.quantity}`}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-neutral-600">{m.running_stock_after}</td>
                        <td className="px-6 py-4 text-neutral-600">{m.performed_by_user?.email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!movementsLoading && movements.length > 0 && (
              <div className="px-6 pb-4">
                <Pagination page={movementsPage} totalPages={movementsTotalPages} total={movementsTotal} onPageChange={setMovementsPage} />
              </div>
            )}
          </div>
        </>
      )}

      {/* Low Stock Tab */}
      {activeTab === 'Low Stock' && (
        <div className="card overflow-hidden !p-0">
          {lowStockLoading ? (
            <LoadingSpinner fullScreen={false} />
          ) : lowStockProducts.length === 0 ? (
            <EmptyState title="No low stock alerts" description="All products are well-stocked." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-neutral-500 bg-neutral-50/80 border-b border-neutral-200">
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Product</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Category</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Current Stock</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Minimum Stock</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Unit</th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500 whitespace-nowrap">Deficit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {lowStockProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-red-50/30 bg-red-50/20">
                      <td className="px-6 py-4 font-medium text-neutral-900">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className="text-red-500 shrink-0" />
                          {p.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-600 capitalize">{p.category_name || '—'}</td>
                      <td className="px-6 py-4 font-medium text-red-600">{p.current_stock}</td>
                      <td className="px-6 py-4 text-neutral-600">{p.minimum_stock}</td>
                      <td className="px-6 py-4 text-neutral-600">{p.unit}</td>
                      <td className="px-6 py-4 font-medium text-red-600">{p.minimum_stock - p.current_stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Adjustments Tab */}
      {activeTab === 'Adjustments' && (
        <div className="card">
          <p className="text-sm text-neutral-500 mb-4">Quick access to stock adjustments and purchase recording.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button onClick={openAddStock} className="flex items-center gap-4 p-5 rounded-md border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30 transition text-left">
              <div className="p-3 rounded-md bg-blue-50 text-primary-700">
                <ArrowUpDown size={22} />
              </div>
              <div>
                <p className="font-medium text-neutral-900">Add Stock</p>
                <p className="text-sm text-neutral-500">Add or deduct stock with a reason</p>
              </div>
            </button>
            <button onClick={() => setPurchaseModalOpen(true)} className="flex items-center gap-4 p-5 rounded-md border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30 transition text-left">
              <div className="p-3 rounded-md bg-green-50 text-green-600">
                <Package size={22} />
              </div>
              <div>
                <p className="font-medium text-neutral-900">Record Purchase</p>
                <p className="text-sm text-neutral-500">Log incoming stock with unit cost</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      <Modal open={adjustModalOpen} onClose={() => setAdjustModalOpen(false)} title={stockAction}>
        <form onSubmit={handleSubmitAdjust(onAdjustSubmit)} className="space-y-4">
          <div>
            <label className="label">Product</label>
            <select className="select-field" {...registerAdjust('product_id', { required: 'Required', valueAsNumber: true })}>
              <option value={0}>Select product</option>
              {allProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {adjustErrors.product_id && <p className="text-xs text-red-600 mt-1">{adjustErrors.product_id.message}</p>}
          </div>
          <div>
            <label className="label">Action</label>
            <select className="select-field" {...registerAdjust('adjustment_type')}>
              <option value="add">Add Stock</option>
              <option value="deduct">Deduct Stock</option>
            </select>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="1" className="input-field" {...registerAdjust('quantity', { required: 'Required', valueAsNumber: true, min: { value: 1, message: 'Must be at least 1' } })} />
            {adjustErrors.quantity && <p className="text-xs text-red-600 mt-1">{adjustErrors.quantity.message}</p>}
          </div>
          <div>
            <label className="label">Reason</label>
            <input className="input-field" placeholder="e.g. Restock, damaged items, count correction" {...registerAdjust('reason', { required: 'Required' })} />
            {adjustErrors.reason && <p className="text-xs text-red-600 mt-1">{adjustErrors.reason.message}</p>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setAdjustModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={adjustSubmitting} className="btn-primary">
              {adjustSubmitting ? (addingStock ? 'Adding Stock...' : 'Deducting Stock...') : stockAction}
            </button>
          </div>
        </form>
      </Modal>

      {/* Purchase Recording Modal */}
      <Modal open={purchaseModalOpen} onClose={() => setPurchaseModalOpen(false)} title="Record Purchase">
        <form onSubmit={handleSubmitPurchase(onPurchaseSubmit)} className="space-y-4">
          <div>
            <label className="label">Product</label>
            <select className="select-field" {...registerPurchase('product_id', { required: 'Required', valueAsNumber: true })}>
              <option value={0}>Select product</option>
              {allProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {purchaseErrors.product_id && <p className="text-xs text-red-600 mt-1">{purchaseErrors.product_id.message}</p>}
          </div>
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="1" className="input-field" {...registerPurchase('quantity', { required: 'Required', valueAsNumber: true, min: { value: 1, message: 'Must be at least 1' } })} />
            {purchaseErrors.quantity && <p className="text-xs text-red-600 mt-1">{purchaseErrors.quantity.message}</p>}
          </div>
          <div>
            <label className="label">Unit Cost (₱)</label>
            <input type="text" inputMode="decimal" className="input-field hide-number-spinners" {...registerMoney(registerPurchase, 'unit_cost', { required: 'Required' })} />
            {purchaseErrors.unit_cost && <p className="text-xs text-red-600 mt-1">{purchaseErrors.unit_cost.message}</p>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setPurchaseModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={purchaseSubmitting} className="btn-primary">
              {purchaseSubmitting ? 'Recording...' : 'Record Purchase'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

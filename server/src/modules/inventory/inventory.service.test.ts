import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('../../config/database', () => ({
  default: { inventory_movements: { findMany, count } },
}));

import { inventoryService } from './inventory.service';
import { listMovementsQuerySchema } from './inventory.validation';

const rows = [
  { id: 1, product_id: 5, type: 'adjustment', quantity: 4 },
  { id: 2, product_id: 5, type: 'adjustment', quantity: -2 },
  { id: 3, product_id: 5, type: 'purchase', quantity: 10 },
  { id: 4, product_id: 6, type: 'adjustment', quantity: 7 },
  { id: 5, product_id: 5, type: 'adjustment', quantity: 0 },
];

function filtered(where: any) {
  return rows.filter((row) => (!where.product_id || row.product_id === where.product_id) &&
    (!where.type || row.type === where.type) &&
    (where.quantity?.gt === undefined || row.quantity > where.quantity.gt) &&
    (where.quantity?.lt === undefined || row.quantity < where.quantity.lt));
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockImplementation(async ({ where }) => filtered(where));
  count.mockImplementation(async ({ where }) => filtered(where).length);
});

describe('Add Stock and Deduct Stock movement-history filters', () => {
  it('selects positive manual changes, including historical adjustment rows, without including purchases', async () => {
    const query = listMovementsQuerySchema.parse({ type: 'added_stock', product_id: '5' });
    const result = await inventoryService.listMovements(query);
    expect(result.data.map((row) => row.id)).toEqual([1]);
    expect(result.pagination.total).toBe(1);
  });

  it('selects negative manual changes without including added stock', async () => {
    const result = await inventoryService.listMovements({ type: 'deducted_stock', product_id: 5 });
    expect(result.data.map((row) => row.id)).toEqual([2]);
    expect(result.pagination.total).toBe(1);
  });

  it('keeps purchases distinct from manually added stock', async () => {
    const result = await inventoryService.listMovements({ type: 'purchase', product_id: 5 });
    expect(result.data.map((row) => row.id)).toEqual([3]);
  });

  it('preserves the old adjustment filter for existing API consumers', async () => {
    const result = await inventoryService.listMovements({ type: 'adjustment', product_id: 5 });
    expect(result.data.map((row) => row.id)).toEqual([1, 2, 5]);
  });

  it('does not ignore the selected product when filtering stock additions', async () => {
    const result = await inventoryService.listMovements({ type: 'added_stock', product_id: 6 });
    expect(result.data.map((row) => row.id)).toEqual([4]);
  });
});

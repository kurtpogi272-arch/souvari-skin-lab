import { z } from 'zod';

const inventoryMovementTypeEnum = z.enum([
  'purchase',
  'sale',
  'adjustment',
  'added_stock',
  'deducted_stock',
  'consumption',
  'return',
  'damage',
  'transfer',
  'opening_stock',
]);

export const listMovementsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  product_id: z.coerce.number().int().positive().optional(),
  type: inventoryMovementTypeEnum.optional(),
  performed_by: z.coerce.number().int().positive().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const createAdjustmentSchema = z.object({
  product_id: z.number().int().positive('Product ID is required'),
  adjustment_type: z.enum(['add', 'deduct']).optional().default('add'),
  quantity: z.number().positive('Quantity must be positive'),
  unit_cost: z.number().min(0).nullable().optional(),
  reason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const createPurchaseSchema = z.object({
  product_id: z.number().int().positive('Product ID is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unit_cost: z.number().min(0, 'Unit cost is required'),
  notes: z.string().nullable().optional(),
});

export const productMovementsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type ProductMovementsQuery = z.infer<typeof productMovementsQuerySchema>;

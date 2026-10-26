import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import {
  getPaginationParams,
  createPaginatedResult,
  PaginatedResult,
} from '../../utils/pagination';
import {
  ListMovementsQuery,
  CreateAdjustmentInput,
  CreatePurchaseInput,
  ProductMovementsQuery,
} from './inventory.validation';
import { Decimal } from '@prisma/client/runtime/library';

class InventoryService {
  async listMovements(query: ListMovementsQuery): Promise<PaginatedResult<any>> {
    const { page, limit, skip } = getPaginationParams(query);
    const { product_id, type, performed_by, start_date, end_date } = query;

    const where: any = {};

    if (product_id) {
      where.product_id = product_id;
    }

    if (type === 'added_stock' || type === 'deducted_stock') {
      where.type = 'adjustment';
      where.quantity = type === 'added_stock' ? { gt: 0 } : { lt: 0 };
    } else if (type) {
      where.type = type;
    }

    if (performed_by) {
      where.performed_by = performed_by;
    }

    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        where.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        where.created_at.lte = new Date(end_date + 'T23:59:59.000Z');
      }
    }

    const [movements, total] = await Promise.all([
      prisma.inventory_movements.findMany({
        where,
        include: {
          product: {
            select: { id: true, name: true, sku: true, unit: true },
          },
          performed_by_user: {
            select: { id: true, email: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.inventory_movements.count({ where }),
    ]);

    return createPaginatedResult(movements, total, { page, limit, skip });
  }

  async getLowStockProducts() {
    const products = await prisma.$queryRaw<any[]>`
      SELECT p.*, pc.name as category_name
      FROM products p
      LEFT JOIN product_categories pc ON p.product_category_id = pc.id
      WHERE p.deleted_at IS NULL
      AND p.current_stock <= p.minimum_stock
      ORDER BY p.current_stock ASC
    `;

    return products;
  }

  async createAdjustment(data: CreateAdjustmentInput, userId: number) {
    const product = await prisma.products.findFirst({
      where: { id: data.product_id, deleted_at: null },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const currentStock = new Decimal(product.current_stock.toString());
    const quantity = new Decimal(data.quantity.toString());
    const isDeduct = data.adjustment_type === 'deduct';

    if (isDeduct && currentStock.lessThan(quantity)) {
      throw new AppError(
        `Insufficient stock: cannot deduct ${data.quantity} from current stock of ${product.current_stock}`,
        400
      );
    }

    const newStock = isDeduct ? currentStock.sub(quantity) : currentStock.add(quantity);

    const movement = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.products.update({
        where: { id: data.product_id },
        data: { current_stock: newStock },
      });

      const inventoryMovement = await tx.inventory_movements.create({
        data: {
          product_id: data.product_id,
          type: 'adjustment',
          quantity: isDeduct ? quantity.negated() : quantity,
          unit_cost: data.unit_cost ?? product.unit_cost,
          running_stock_after: newStock,
          reference_type: 'manual',
          performed_by: userId,
          notes: data.reason ?? data.notes ?? null,
        },
      });

      return { product: updatedProduct, movement: inventoryMovement };
    });

    return movement;
  }

  async createPurchase(data: CreatePurchaseInput, userId: number) {
    const product = await prisma.products.findFirst({
      where: { id: data.product_id, deleted_at: null },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const currentStock = new Decimal(product.current_stock.toString());
    const quantity = new Decimal(data.quantity.toString());
    const newStock = currentStock.add(quantity);

    const movement = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.products.update({
        where: { id: data.product_id },
        data: { current_stock: newStock },
      });

      const inventoryMovement = await tx.inventory_movements.create({
        data: {
          product_id: data.product_id,
          type: 'purchase',
          quantity: data.quantity,
          unit_cost: data.unit_cost,
          running_stock_after: newStock,
          reference_type: 'manual',
          performed_by: userId,
          notes: data.notes ?? null,
        },
      });

      return { product: updatedProduct, movement: inventoryMovement };
    });

    return movement;
  }

  async getProductMovements(
    productId: number,
    query: ProductMovementsQuery
  ): Promise<PaginatedResult<any>> {
    const { page, limit, skip } = getPaginationParams(query);

    const product = await prisma.products.findFirst({
      where: { id: productId, deleted_at: null },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const where = { product_id: productId };

    const [movements, total] = await Promise.all([
      prisma.inventory_movements.findMany({
        where,
        include: {
          performed_by_user: {
            select: { id: true, email: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.inventory_movements.count({ where }),
    ]);

    return createPaginatedResult(movements, total, { page, limit, skip });
  }
}

export const inventoryService = new InventoryService();

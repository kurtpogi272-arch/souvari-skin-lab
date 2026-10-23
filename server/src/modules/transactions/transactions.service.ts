import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPaginationParams, createPaginatedResult } from '../../utils/pagination';
import {
  CreateTransactionInput,
  ListTransactionsQuery,
  ReportTransactionsQuery,
  VoidTransactionInput,
  RefundTransactionInput,
} from './transactions.validation';
import {
  summarizeTransactions,
  summarizeGroupedRows,
  groupTotals,
  groupByDay,
  resolvePeriod,
} from './transactions-report-math';
import { transactionDateFilter, transactionReportDate } from './transaction-dates';
import { Decimal } from '@prisma/client/runtime/library';
import { notificationDispatch } from '../../services/notification-dispatch.service';

export class TransactionService {
  private async generateTransactionNumber(): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `TXN-${dateStr}-`;

    const lastTxn = await prisma.transactions.findFirst({
      where: {
        transaction_number: { startsWith: prefix },
      },
      orderBy: { transaction_number: 'desc' },
      select: { transaction_number: true },
    });

    let nextNumber = 1;
    if (lastTxn) {
      const parts = lastTxn.transaction_number.split('-');
      nextNumber = parseInt(parts[parts.length - 1], 10) + 1;
    }

    return `${prefix}${String(nextNumber).padStart(5, '0')}`;
  }

  async createTransaction(data: CreateTransactionInput, userId: number) {
    const transactionNumber = await this.generateTransactionNumber();
    let markedCompleted = false;
    let completedFromStatus: string | null = null;

    const transaction = await prisma.$transaction(async (tx) => {
      for (const item of data.items) {
        if (item.product_id) {
          const product = await tx.products.findFirst({
            where: { id: item.product_id, deleted_at: null },
          });
          if (!product) {
            throw new AppError(`Product with ID ${item.product_id} not found`, 404);
          }
          if (product.status !== 'active') {
            throw new AppError(
              `Product "${product.name}" is ${product.status} and cannot be sold`,
              400
            );
          }

          const quantity = new Decimal(item.quantity.toString());
          const currentStock = new Decimal(product.current_stock.toString());
          const newStock = currentStock.minus(quantity);

          if (newStock.isNegative()) {
            throw new AppError(
              `Insufficient stock for product "${product.name}". Available: ${currentStock}, Requested: ${quantity}`,
              400
            );
          }

          await tx.products.update({
            where: { id: item.product_id },
            data: { current_stock: newStock },
          });

          await tx.inventory_movements.create({
            data: {
              product_id: item.product_id,
              type: 'sale',
              quantity: quantity,
              unit_cost: product.unit_cost,
              running_stock_after: newStock,
              reference_type: 'transaction',
              reference_id: null,
              performed_by: userId,
              notes: `Sale via transaction ${transactionNumber}`,
            },
          });
        }

        if (item.service_id) {
          const service = await tx.services.findFirst({
            where: { id: item.service_id, deleted_at: null },
          });
          if (!service) {
            throw new AppError(`Service with ID ${item.service_id} not found`, 404);
          }
        }
      }

      if (data.appointment_id) {
        const appointment = await tx.appointments.findFirst({
          where: { id: data.appointment_id, deleted_at: null },
        });
        if (!appointment) {
          throw new AppError(`Appointment with ID ${data.appointment_id} not found`, 404);
        }
      }

      let subtotal = new Decimal(0);
      for (const item of data.items) {
        const quantity = new Decimal(item.quantity.toString());
        const unitPrice = new Decimal(item.unit_price.toString());
        const discount = new Decimal((item.discount ?? 0).toString());
        const tax = new Decimal((item.tax ?? 0).toString());
        const lineTotal = unitPrice.times(quantity).minus(discount).plus(tax);
        subtotal = subtotal.plus(lineTotal);
      }

      let discountAmount = new Decimal((data.discount_amount ?? 0).toString());
      if (data.discount_pct && discountAmount.isZero()) {
        discountAmount = subtotal.times(new Decimal(data.discount_pct.toString()).div(100));
      }
      const taxAmount = new Decimal((data.tax_amount ?? 0).toString());
      const totalAmount = subtotal.minus(discountAmount).plus(taxAmount);

      const createdTransaction = await tx.transactions.create({
        data: {
          transaction_number: transactionNumber,
          customer_id: data.customer_id ?? null,
          staff_id: data.staff_id ?? null,
          appointment_id: data.appointment_id ?? null,
          type: data.type ?? 'sale',
          subtotal,
          discount_amount: discountAmount,
          discount_pct: data.discount_pct ? new Decimal(data.discount_pct.toString()) : null,
          discount_reason: data.discount_reason ?? null,
          discount_applied_by: data.discount_applied_by ?? null,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          payment_method: data.payment_method ?? null,
          payment_status: data.payment_status ?? 'pending',
          paid_at: data.paid_at ?? null,
          notes: data.notes ?? null,
        },
      });

      const createdItems = [];
      for (const item of data.items) {
        const quantity = new Decimal(item.quantity.toString());
        const unitPrice = new Decimal(item.unit_price.toString());
        const discount = new Decimal((item.discount ?? 0).toString());
        const tax = new Decimal((item.tax ?? 0).toString());
        const lineTotal = unitPrice.times(quantity).minus(discount).plus(tax);

        const createdItem = await tx.transaction_items.create({
          data: {
            transaction_id: createdTransaction.id,
            product_id: item.product_id ?? null,
            service_id: item.service_id ?? null,
            description: item.description,
            quantity,
            unit_price: unitPrice,
            discount,
            tax,
            line_total: lineTotal,
          },
        });
        createdItems.push(createdItem);
      }

      if (data.appointment_id) {
        const appointment = await tx.appointments.findFirst({
          where: { id: data.appointment_id },
        });

        if (appointment && appointment.status !== 'completed' && appointment.status !== 'cancelled') {
          markedCompleted = true;
          completedFromStatus = appointment.status;
          await tx.appointments.update({
            where: { id: data.appointment_id },
            data: {
              status: 'completed',
              // Persist the POS discount back onto the appointment so the
              // booking's discount history reflects what was actually
              // granted at settlement.
              ...(data.discount_pct !== undefined && data.discount_pct !== null
                ? {
                    discount_pct: data.discount_pct,
                    discount_reason: data.discount_reason ?? null,
                  }
                : {}),
            },
          });

          await tx.appointment_status_history.create({
            data: {
              appointment_id: data.appointment_id,
              old_status: appointment.status,
              new_status: 'completed',
              changed_by: userId,
              reason: 'Service completed via transaction',
            },
          });

          const existingRecord = await tx.treatment_records.findUnique({
            where: { appointment_id: data.appointment_id },
          });
          if (!existingRecord) {
            await tx.treatment_records.create({
              data: {
                appointment_id: data.appointment_id,
                staff_id: appointment.staff_id,
                customer_id: appointment.customer_id,
                service_id: appointment.service_id,
                treatment_date: appointment.appointment_date,
                start_time: appointment.start_time ?? null,
                end_time: appointment.end_time ?? null,
              },
            });
          }
        }

        const serviceItems = data.items.filter((item) => item.service_id);
        for (const item of serviceItems) {
          const inventoryItems = await tx.service_inventory_items.findMany({
            where: { service_id: item.service_id! },
          });

          for (const invItem of inventoryItems) {
            const product = await tx.products.findFirst({
              where: { id: invItem.product_id, deleted_at: null },
            });
            if (!product) continue;

            const qtyPerSession = new Decimal(invItem.quantity_per_session.toString());
            const quantity = new Decimal(item.quantity.toString());
            const consumeQty = qtyPerSession.times(quantity);
            const currentStock = new Decimal(product.current_stock.toString());
            const newStock = currentStock.minus(consumeQty);

            if (newStock.isNegative()) {
              throw new AppError(
                `Insufficient stock for service consumption of "${product.name}". Available: ${currentStock}, Needed: ${consumeQty}`,
                400
              );
            }

            await tx.products.update({
              where: { id: invItem.product_id },
              data: { current_stock: newStock },
            });

            await tx.inventory_movements.create({
              data: {
                product_id: invItem.product_id,
                type: 'consumption',
                quantity: consumeQty,
                unit_cost: product.unit_cost,
                running_stock_after: newStock,
                reference_type: 'transaction',
                reference_id: createdTransaction.id,
                performed_by: userId,
                notes: `Service consumption for transaction ${transactionNumber}`,
              },
            });
          }
        }
      }

      return {
        ...createdTransaction,
        items: createdItems,
      };
    });

    // Dispatch completion notification if appointment was marked completed
    if (markedCompleted && data.appointment_id) {
      try {
        const appt = await prisma.appointments.findUnique({
          where: { id: data.appointment_id },
          include: {
            customer: { select: { user_id: true, first_name: true, last_name: true } },
            staff: { select: { user_id: true, first_name: true, last_name: true } },
            service: { select: { name: true } },
          },
        });
        if (appt) {
          const customerUser = await prisma.users.findUnique({
            where: { id: appt.customer.user_id },
            select: { id: true, phone: true },
          });
          const staffUser = appt.staff
            ? await prisma.users.findUnique({
                where: { id: appt.staff.user_id },
                select: { id: true, phone: true },
              })
            : null;
          const adminUserIds = await notificationDispatch.getAdminUserIds();
          const apptDate = new Date(appt.appointment_date).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          await notificationDispatch.dispatchAppointmentStatus({
            appointmentId: appt.id,
            oldStatus: completedFromStatus ?? 'in_progress',
            newStatus: 'completed',
            customerUserId: customerUser?.id ?? 0,
            customerName: `${appt.customer.first_name} ${appt.customer.last_name}`,
            customerPhone: customerUser?.phone ?? null,
            staffUserId: staffUser?.id ?? null,
            staffName: appt.staff ? `${appt.staff.first_name} ${appt.staff.last_name}` : '',
            serviceName: appt.service.name,
            appointmentDate: apptDate,
            appointmentTime: appt.start_time ?? '',
            adminUserIds,
          });
        }
      } catch (err) {
        // Notification failure should not block
      }
    }

    return transaction;
  }

  /**
   * Build the Prisma filter shared by the paginated list and the report.
   *
   * Both must agree on exactly which rows are in scope, so the rules live in one
   * place instead of being duplicated per endpoint.
   */
  private async buildTransactionsWhere(query: ListTransactionsQuery): Promise<any> {
    const {
      search,
      customer,
      type,
      payment_status,
      payment_method,
      customer_id,
      staff_id,
      appointment_id,
      date_from,
      date_to,
    } = query;

    const where: any = { deleted_at: null };

    if (search) {
      where.OR = [
        { transaction_number: { contains: search } },
        { notes: { contains: search } },
      ];
    }

    if (customer) {
      const matchingCustomers = await prisma.customers.findMany({
        where: {
          deleted_at: null,
          OR: [
            { first_name: { contains: customer } },
            { last_name: { contains: customer } },
          ],
        },
        select: { id: true },
      });
      const customerIds = matchingCustomers.map((c) => c.id);
      if (customerIds.length > 0) {
        where.customer_id = { in: customerIds };
      } else {
        // No match must select nothing rather than every customer.
        where.customer_id = -1;
      }
    }

    if (type) where.type = type;
    if (payment_status) where.payment_status = payment_status;
    if (payment_method) where.payment_method = payment_method;
    if (customer_id) where.customer_id = customer_id;
    if (staff_id) where.staff_id = staff_id;
    if (appointment_id) where.appointment_id = appointment_id;

    Object.assign(where, transactionDateFilter(date_from, date_to));

    return where;
  }

  async getTransactions(query: ListTransactionsQuery) {
    const pagination = getPaginationParams(query);
    const { sort_by, sort_order } = query;

    const where = await this.buildTransactionsWhere(query);

    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order || 'desc';
    } else {
      orderBy.created_at = 'desc';
    }

    const [transactions, total, totalsByGroup] = await Promise.all([
      prisma.transactions.findMany({
        where,
        include: {
          customer: {
            select: { id: true, first_name: true, last_name: true },
          },
          staff: {
            select: { id: true, first_name: true, last_name: true },
          },
          items: {
            include: {
              product: { select: { id: true, name: true } },
              service: { select: { id: true, name: true, price: true } },
            },
          },
          // Lets the client show the visit date for appointment-linked sales
          // instead of the record timestamp.
          appointment: { select: { appointment_date: true } },
        },
        orderBy,
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.transactions.count({ where }),
      // Totals cover every matching row, not just this page, so the headline
      // figures on screen are the real ones and match the exported report.
      prisma.transactions.groupBy({
        by: ['type', 'payment_status'],
        where,
        _sum: { total_amount: true, discount_amount: true, tax_amount: true },
        _count: { _all: true },
      }),
    ]);

    const groups = (totalsByGroup as any[]).map((g) => ({
      type: g.type,
      payment_status: g.payment_status,
      total_amount: g._sum?.total_amount ?? 0,
      discount_amount: g._sum?.discount_amount ?? 0,
      tax_amount: g._sum?.tax_amount ?? 0,
      _count: g._count?._all ?? 0,
    }));

    const page = createPaginatedResult(transactions, total, { page: pagination.page, limit: pagination.limit, skip: pagination.skip });
    return { ...page, summary: summarizeGroupedRows(groups) };
  }

  /**
   * Full filtered data set plus aggregates for the PDF/Excel export.
   *
   * Deliberately not paginated: a report that only covers the rows currently on
   * screen would be misleading as a financial record, and the totals have to be
   * computed over every matching row rather than one page of them.
   */
  async getTransactionReport(query: ReportTransactionsQuery) {
    const where = await this.buildTransactionsWhere(query);

    const { sort_by, sort_order } = query;
    const orderBy: any = {};
    if (sort_by) {
      orderBy[sort_by] = sort_order || 'desc';
    } else {
      orderBy.created_at = 'desc';
    }

    const transactions = await prisma.transactions.findMany({
      where,
      select: {
        id: true,
        transaction_number: true,
        type: true,
        payment_status: true,
        payment_method: true,
        created_at: true,
        subtotal: true,
        discount_amount: true,
        tax_amount: true,
        total_amount: true,
        notes: true,
        customer: { select: { id: true, first_name: true, last_name: true } },
        staff: { select: { id: true, first_name: true, last_name: true } },
        // An appointment-linked sale is reported under the visit date, so the
        // day buckets and period match the date filter above.
        appointment: { select: { appointment_date: true } },
        // Only the count is rendered, so the line detail is left out to keep the
        // response small on large date ranges.
        items: { select: { id: true } },
      },
      orderBy,
    });

    const rows = transactions.map((t) => ({
      id: t.id,
      transaction_number: t.transaction_number,
      type: t.type,
      payment_status: t.payment_status,
      payment_method: t.payment_method,
      created_at: transactionReportDate(t),
      subtotal: t.subtotal,
      discount_amount: t.discount_amount,
      tax_amount: t.tax_amount,
      total_amount: t.total_amount,
      notes: t.notes,
      customer: t.customer,
      staff: t.staff,
      item_count: t.items.length,
    }));

    const summary = summarizeTransactions(rows);
    const period = resolvePeriod(rows, { date_from: query.date_from, date_to: query.date_to });

    return {
      period,
      summary,
      rows,
      by_status: groupTotals(rows, 'payment_status', (v) => v),
      by_method: groupTotals(rows, 'payment_method', (v) => v),
      by_type: groupTotals(rows, 'type', (v) => v),
      by_day: groupByDay(rows),
    };
  }

  async getTransactionById(id: number) {
    const transaction = await prisma.transactions.findFirst({
      where: { id, deleted_at: null },
      include: {
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            user: { select: { phone: true } },
          },
        },
        staff: {
          select: { id: true, first_name: true, last_name: true },
        },
        appointment: {
          select: { id: true, appointment_date: true, start_time: true, end_time: true, status: true },
        },
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true },
            },
            service: {
              select: { id: true, name: true, price: true },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new AppError('Transaction not found', 404);
    }

    return transaction;
  }

  async voidTransaction(id: number, data: VoidTransactionInput, userId: number) {
    const existing = await prisma.transactions.findFirst({
      where: { id, deleted_at: null },
      include: { items: true },
    });

    if (!existing) {
      throw new AppError('Transaction not found', 404);
    }

    if (existing.payment_status === 'voided') {
      throw new AppError('Transaction is already voided', 400);
    }

    if (existing.payment_status === 'refunded') {
      throw new AppError('Cannot void a refunded transaction', 400);
    }

    const updatedTransaction = await prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        if (item.product_id) {
          const product = await tx.products.findFirst({
            where: { id: item.product_id, deleted_at: null },
          });
          if (!product) continue;

          const quantity = new Decimal(item.quantity.toString());
          const currentStock = new Decimal(product.current_stock.toString());
          const newStock = currentStock.plus(quantity);

          await tx.products.update({
            where: { id: item.product_id },
            data: { current_stock: newStock },
          });

          await tx.inventory_movements.create({
            data: {
              product_id: item.product_id,
              type: 'return',
              quantity: quantity,
              unit_cost: product.unit_cost,
              running_stock_after: newStock,
              reference_type: 'transaction',
              reference_id: id,
              performed_by: userId,
              notes: `Return from voided transaction ${existing.transaction_number}`,
            },
          });
        }
      }

      if (existing.appointment_id) {
        const appointment = await tx.appointments.findFirst({
          where: { id: existing.appointment_id },
        });

        if (appointment && appointment.status === 'completed') {
          await tx.appointments.update({
            where: { id: existing.appointment_id },
            data: { status: 'in_progress' },
          });

          await tx.appointment_status_history.create({
            data: {
              appointment_id: existing.appointment_id,
              old_status: 'completed',
              new_status: 'in_progress',
              changed_by: userId,
              reason: data.reason ?? 'Transaction voided',
            },
          });
        }
      }

      const result = await tx.transactions.update({
        where: { id },
        data: {
          payment_status: 'voided',
          notes: data.reason
            ? `${existing.notes ? existing.notes + ' | ' : ''}${data.reason}`
            : existing.notes,
        },
      });

      return result;
    });

    return updatedTransaction;
  }

  async refundTransaction(id: number, data: RefundTransactionInput, userId: number) {
    const existing = await prisma.transactions.findFirst({
      where: { id, deleted_at: null },
      include: { items: true },
    });

    if (!existing) {
      throw new AppError('Transaction not found', 404);
    }

    if (existing.payment_status === 'voided') {
      throw new AppError('Cannot refund a voided transaction', 400);
    }

    if (existing.payment_status === 'refunded') {
      throw new AppError('Transaction is already refunded', 400);
    }

    const itemsToRefund = data.item_ids
      ? existing.items.filter((item) => data.item_ids!.includes(item.id))
      : existing.items;

    if (itemsToRefund.length === 0) {
      throw new AppError('No valid items selected for refund', 400);
    }

    const refundNumber = await this.generateTransactionNumber();

    const refundTransaction = await prisma.$transaction(async (tx) => {
      let subtotal = new Decimal(0);
      const refundItemsData = [];

      for (const item of itemsToRefund) {
        const quantity = new Decimal(item.quantity.toString());
        const unitPrice = new Decimal(item.unit_price.toString());
        const discount = new Decimal(item.discount.toString());
        const tax = new Decimal(item.tax.toString());
        const negQuantity = new Decimal(-1).times(quantity);
        const negUnitPrice = new Decimal(-1).times(unitPrice);
        const negDiscount = new Decimal(-1).times(discount);
        const negTax = new Decimal(-1).times(tax);
        const lineTotal = negUnitPrice.times(quantity).plus(discount).minus(tax);

        subtotal = subtotal.plus(lineTotal);

        refundItemsData.push({
          product_id: item.product_id,
          service_id: item.service_id,
          description: `Refund: ${item.description}`,
          quantity: negQuantity,
          unit_price: negUnitPrice,
          discount: negDiscount,
          tax: negTax,
          line_total: lineTotal,
        });
      }

      const refundDiscount = new Decimal(existing.discount_amount.toString());
      const refundTax = new Decimal(existing.tax_amount.toString());
      const refundTotal = subtotal.plus(refundDiscount).minus(refundTax);

      const refund = await tx.transactions.create({
        data: {
          transaction_number: refundNumber,
          customer_id: existing.customer_id,
          staff_id: existing.staff_id,
          appointment_id: existing.appointment_id,
          type: 'refund',
          subtotal,
          discount_amount: new Decimal(0),
          tax_amount: new Decimal(0),
          total_amount: refundTotal,
          payment_method: data.payment_method ?? existing.payment_method,
          payment_status: 'paid',
          paid_at: new Date(),
          notes: data.reason ?? `Refund for transaction ${existing.transaction_number}`,
        },
      });

      const createdRefundItems = [];
      for (const refundItemData of refundItemsData) {
        const createdItem = await tx.transaction_items.create({
          data: {
            transaction_id: refund.id,
            ...refundItemData,
          },
        });
        createdRefundItems.push(createdItem);
      }

      for (const item of itemsToRefund) {
        if (item.product_id) {
          const product = await tx.products.findFirst({
            where: { id: item.product_id, deleted_at: null },
          });
          if (!product) continue;

          const quantity = new Decimal(item.quantity.toString());
          const currentStock = new Decimal(product.current_stock.toString());
          const newStock = currentStock.plus(quantity);

          await tx.products.update({
            where: { id: item.product_id },
            data: { current_stock: newStock },
          });

          await tx.inventory_movements.create({
            data: {
              product_id: item.product_id,
              type: 'return',
              quantity: quantity,
              unit_cost: product.unit_cost,
              running_stock_after: newStock,
              reference_type: 'transaction',
              reference_id: refund.id,
              performed_by: userId,
              notes: `Restored from refund on transaction ${existing.transaction_number}`,
            },
          });
        }
      }

      const allRefunded = itemsToRefund.length === existing.items.length;
      await tx.transactions.update({
        where: { id },
        data: {
          payment_status: allRefunded ? 'refunded' : 'partial',
          notes: `${existing.notes ? existing.notes + ' | ' : ''}Refunded via ${refundNumber}`,
        },
      });

      return {
        ...refund,
        items: createdRefundItems,
        original_transaction_number: existing.transaction_number,
      };
    });

    return refundTransaction;
  }
}

export const transactionService = new TransactionService();

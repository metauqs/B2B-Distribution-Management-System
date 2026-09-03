import prisma from '../lib/prisma';
import { getBusinessDateString } from '../lib/businessDate';
import { stockReturn } from '../lib/inventoryService';
import {
  recordCustomerLedgerEntry,
  reconcileClientBalancesAndAllocations,
  getValidUserId,
  parseInvoiceSequence,
} from '../lib/business';
import { claimIdempotencyKey, saveIdempotencyResponse } from '../lib/idempotency';

export interface InvoiceCancellationParams {
  invoiceId: string;
  adminUserId?: string | null;
  adminRole?: string | null;
  branchId?: string | null;
  reason?: string;
  idempotencyKey?: string | null;
  isDuplicateCompaction?: boolean;
}

export interface InvoiceCancellationResult {
  success: boolean;
  action: 'CANCELLED_LAST_SEQUENCE' | 'CANCELLED_AND_COMPACTED' | 'CANCELLED_HISTORICAL' | 'CANCELLED_MIDDLE_SEQUENCE' | 'REPLAYED';
  sale: any;
  oldInvoiceNo: string;
  newInvoiceNo: string;
  reassignedSale: {
    id: string;
    oldInvoiceNo: string;
    newInvoiceNo: string;
  } | null;
  businessDate: string;
  currentBusinessDate: string;
  isCurrentBusinessDay: boolean;
  reversalSummary: {
    productsRestored: Array<{ productId: string; qty: number; unit: string; name?: string }>;
    ledgerCredited: number;
    collectionsReconciled: number;
    newClientBalance: number;
  };
}

const AUTHORIZED_ADMIN_ROLES = ['ADMIN', 'OWNER', 'MANAGER', 'SUPER_ADMIN', 'SUPERVISOR'];

/**
 * Authoritative production-safe Invoice Cancellation Service.
 * Single source of truth for reversing an invoice's inventory, financial dues,
 * customer ledger, collection allocations, and handling business-day-aware numbering.
 */
export async function deleteOrCancelInvoice(
  params: InvoiceCancellationParams
): Promise<InvoiceCancellationResult> {
  const { invoiceId, adminUserId, adminRole, reason, idempotencyKey, isDuplicateCompaction } = params;

  // 1. Authorization: Only administrative roles may cancel/delete invoices
  if (adminRole && !AUTHORIZED_ADMIN_ROLES.includes(adminRole.toUpperCase())) {
    const err: any = new Error('Unauthorized: Only administrators and managers are authorized to cancel or delete invoices.');
    err.statusCode = 403;
    throw err;
  }

  // 2. Idempotency Check
  let scopedIdempKey: string | null = null;
  if (idempotencyKey && idempotencyKey.trim()) {
    scopedIdempKey = `invoice_cancel:${params.branchId || 'default'}:${adminUserId || 'admin'}:${invoiceId}:${idempotencyKey.trim()}`;
    const claim = await claimIdempotencyKey(scopedIdempKey, '/api/sales/cancel');
    if (claim.isDuplicate && claim.record?.response) {
      const cached = claim.record.response as InvoiceCancellationResult;
      return { ...cached, action: 'REPLAYED' };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Concurrency Safety: Lock target Sale row with FOR UPDATE to serialize concurrent cancellation attempts
      await tx.$executeRaw`SELECT id FROM sales WHERE id = ${invoiceId} FOR UPDATE`;

      // 2. Fetch target invoice with all related entities
      const sale = await tx.sale.findUnique({
        where: { id: invoiceId, deletedAt: null },
        include: {
          items: { include: { product: true } },
          client: true,
          deliveries: true,
        },
      });

      if (!sale) {
        const err: any = new Error('Invoice not found');
        err.statusCode = 404;
        throw err;
      }

      if (sale.status === 'CANCELLED') {
        const err: any = new Error('Invoice is already cancelled');
        err.statusCode = 400;
        throw err;
      }

      const branchId = params.branchId || sale.branchId;
      const validatedUserId = await getValidUserId(adminUserId || null, tx);

      // 2. Determine authoritative business dates (5:00 AM PKT cutoff rule)
      const invoiceBusinessDate = getBusinessDateString(sale.date);
      const currentBusinessDate = getBusinessDateString(new Date());
      const isCurrentBusinessDay = (invoiceBusinessDate === currentBusinessDate);

      // 3. Determine Numbering Behavior (Cases A, B, C, D)
      const parsedTarget = parseInvoiceSequence(sale.invoiceNo);
      let action: InvoiceCancellationResult['action'] = 'CANCELLED_HISTORICAL';
      let reassignedSale: InvoiceCancellationResult['reassignedSale'] = null;

      if (!isCurrentBusinessDay) {
        // CASE D: Previous/Historical Business Day
        // Invoices from previous business days remain permanently marked as CANCELLED.
        // Never renumber subsequent invoices or alter current-day sequence.
        action = 'CANCELLED_HISTORICAL';
      } else {
        // CURRENT BUSINESS DAY: Check other active invoices for this client today
        const otherSales = await tx.sale.findMany({
          where: {
            clientId: sale.clientId,
            deletedAt: null,
            status: { not: 'CANCELLED' },
            id: { not: sale.id },
          },
          orderBy: { createdAt: 'asc' },
        });

        const currentDayOtherSales = otherSales.filter(
          (s) => getBusinessDateString(s.date) === currentBusinessDate
        );

        if (parsedTarget) {
          // Look for an immediate consecutive successor invoice: seq(Y) === seq(sale) + 1
          const immediateSuccessor = currentDayOtherSales.find((s) => {
            const parsedOther = parseInvoiceSequence(s.invoiceNo);
            return parsedOther && parsedOther.seq === parsedTarget.seq + 1;
          });

          if (immediateSuccessor) {
            // Check if successor is a duplicate bill (Case B)
            // Duplicate condition: same total amount (within 0.01) OR explicit duplicate flag
            const isDuplicate = isDuplicateCompaction || Math.abs(immediateSuccessor.total - sale.total) < 0.01;

            if (isDuplicate) {
              // CASE B: Duplicate Current-Day Invoice
              // #10 is cancelled & reversed. Surviving duplicate #11 becomes #10.
              action = 'CANCELLED_AND_COMPACTED';
              reassignedSale = {
                id: immediateSuccessor.id,
                oldInvoiceNo: immediateSuccessor.invoiceNo,
                newInvoiceNo: sale.invoiceNo,
              };
            } else {
              // CASE C: Current Day has multiple distinct invoices (#10, #11, #12)
              // Admin cancels #11. Subsequent #12 is NOT shifted unless duplicate.
              action = 'CANCELLED_MIDDLE_SEQUENCE';
            }
          } else {
            // CASE A: Target invoice is the last / active sequence position of the day.
            // No subsequent active invoice requires preservation.
            // When cancelled, sequence position is freed so next invoice reuses it.
            action = 'CANCELLED_LAST_SEQUENCE';
          }
        } else {
          action = 'CANCELLED_LAST_SEQUENCE';
        }
      }

      // 4. Exact Inventory Reversal
      const productsRestored: Array<{ productId: string; qty: number; unit: string; name?: string }> = [];
      for (const item of sale.items) {
        const netDeducted = Number(item.qty) - Number(item.returnedQty || 0);
        if (netDeducted > 0 && item.productId) {
          await stockReturn(tx, {
            productId: item.productId,
            branchId,
            qty: netDeducted,
            unit: item.unit || 'KG',
            refType: 'sale_cancelled',
            refId: sale.id,
            refNo: sale.invoiceNo,
            reason: `Invoice Cancelled${reason ? ` - ${reason}` : ''}`,
            userId: validatedUserId ?? undefined,
          });

          productsRestored.push({
            productId: item.productId,
            qty: netDeducted,
            unit: item.unit || 'KG',
            name: item.itemName,
          });
        }
      }

      // 5. Customer Ledger Reversal
      // Record a CANCELLATION entry in CustomerLedger to reverse the invoice's original debit
      await recordCustomerLedgerEntry(tx, {
        clientId: sale.clientId,
        branchId,
        type: 'CANCELLATION',
        date: new Date(),
        referenceId: sale.id,
        referenceNo: sale.invoiceNo,
        description: `Invoice Cancelled (${sale.invoiceNo})${reason ? ` — ${reason}` : ''}`,
        debit: 0,
        credit: sale.total,
      });

      // 6. Financial Ledger Double-Entry Cleanup
      await tx.financialLedger.deleteMany({
        where: { referenceId: sale.id, referenceType: 'sale' },
      });

      // 7. Linked Delivery Tracking Update
      if (sale.deliveries && sale.deliveries.length > 0) {
        await tx.delivery.updateMany({
          where: { saleId: sale.id },
          data: {
            status: 'FAILED',
            failureReason: `Invoice Cancelled${reason ? `: ${reason}` : ''}`,
          },
        });
      }

      // 8. Mark Target Sale as CANCELLED and free original invoiceNo
      const cancelledInvoiceNo = `${sale.invoiceNo}-CANCELLED`;
      const updatedCancelledSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'CANCELLED',
          balance: 0,
          paid: 0,
          invoiceNo: cancelledInvoiceNo,
        },
        include: {
          items: { include: { product: true } },
          client: true,
        },
      });

      // 9. Reassign Surviving Invoice Number if Duplicate Compaction (Case B)
      if (reassignedSale) {
        await tx.sale.update({
          where: { id: reassignedSale.id },
          data: { invoiceNo: reassignedSale.newInvoiceNo },
        });

        // Synchronize ledger references to new invoiceNo
        await tx.customerLedger.updateMany({
          where: { referenceId: reassignedSale.id },
          data: { referenceNo: reassignedSale.newInvoiceNo },
        });

        await tx.financialLedger.updateMany({
          where: { referenceId: reassignedSale.id, referenceType: 'sale' },
          data: { referenceNo: reassignedSale.newInvoiceNo },
        });
      }

      // 10. Single Source of Truth Reconcile:
      // Cleans up allocations to the cancelled sale, applies collection funds FIFO to active sales/opening balance,
      // recomputes running balances in CustomerLedger, and updates Client.currentBalance.
      const reconcileOutcome = await reconcileClientBalancesAndAllocations(sale.clientId, tx);

      // 11. Record Comprehensive Audit Log
      await tx.auditLog.create({
        data: {
          userId: validatedUserId ?? undefined,
          branchId,
          action: 'CANCEL_INVOICE',
          entity: 'Sale',
          entityId: sale.id,
          oldData: {
            invoiceNo: sale.invoiceNo,
            total: sale.total,
            paid: sale.paid,
            balance: sale.balance,
            status: sale.status,
            businessDate: invoiceBusinessDate,
          },
          newData: {
            invoiceNo: cancelledInvoiceNo,
            newStatus: 'CANCELLED',
            action,
            reason: reason || 'Invoice cancelled by admin',
            currentBusinessDate,
            isCurrentBusinessDay,
            reassignedSale,
            productsRestoredCount: productsRestored.length,
            newClientBalance: reconcileOutcome.clientBalance,
          },
        },
      });

      return {
        success: true,
        action,
        sale: updatedCancelledSale,
        oldInvoiceNo: sale.invoiceNo,
        newInvoiceNo: cancelledInvoiceNo,
        reassignedSale,
        businessDate: invoiceBusinessDate,
        currentBusinessDate,
        isCurrentBusinessDay,
        reversalSummary: {
          productsRestored,
          ledgerCredited: sale.total,
          collectionsReconciled: reconcileOutcome.reconciledAllocations,
          newClientBalance: reconcileOutcome.clientBalance,
        },
      };
    }, { maxWait: 15000, timeout: 120000 });

    // 12. Save Idempotency Result
    if (scopedIdempKey) {
      await saveIdempotencyResponse(scopedIdempKey, result, 200);
    }

    return result;
  } catch (error: any) {
    console.error(`[deleteOrCancelInvoice] Failed to cancel invoice ${invoiceId}:`, error);
    throw error;
  }
}

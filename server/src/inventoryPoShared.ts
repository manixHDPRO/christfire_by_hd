// @ts-nocheck

import { db } from "./db.js";
export function getQtyReceivedForPurchaseOrderItem(purchaseOrderId, itemId) {
    const row = db
        .prepare(`SELECT COALESCE(SUM(m.qty_delta), 0) AS q
       FROM stock_movements m
       JOIN stock_documents d ON d.id = m.document_id
       WHERE d.doc_type = 'receipt'
         AND d.purchase_order_id = ?
         AND m.item_id = ?
         AND m.ledger_kind = 'receipt'`)
        .get(purchaseOrderId, itemId);
    return Number(row.q);
}
export function maybeClosePurchaseOrderIfComplete(purchaseOrderId) {
    const lines = db
        .prepare(`SELECT item_id AS itemId, qty_ordered AS qtyOrdered FROM stock_purchase_order_lines WHERE purchase_order_id = ?`)
        .all(purchaseOrderId);
    if (lines.length === 0)
        return;
    for (const ln of lines) {
        const recv = getQtyReceivedForPurchaseOrderItem(purchaseOrderId, ln.itemId);
        if (recv + 1e-9 < ln.qtyOrdered)
            return;
    }
    db.prepare(`UPDATE stock_purchase_orders SET status = 'closed' WHERE id = ? AND status = 'approved'`).run(purchaseOrderId);
}

// @ts-nocheck

import { randomUUID } from "node:crypto";
import { Router as createRouter } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { insertFinanceCashExpense } from "../financeCashExpense.js";
import { getQtyReceivedForPurchaseOrderItem } from "../inventoryPoShared.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { roleHasPermission } from "../permissions.js";
const logisticsPerm = requireAnyPermission("logistics.inventory");
const poReaderPerm = requireAnyPermission("logistics.inventory", "logistics.po_approve_manager", "logistics.po_approve_dg");
const approveManagerPerm = requireAnyPermission("logistics.po_approve_manager");
const approveDgPerm = requireAnyPermission("logistics.po_approve_dg");
const approverLinesPerm = requireAnyPermission("logistics.po_approve_manager", "logistics.po_approve_dg");
const cashBookPerm = requireAnyPermission("finance.cash_book");
function requireRejectPurchaseOrder(req, res, next) {
    const role = req.auth?.role;
    if (!role) {
        res.status(401).json({ code: "unauthorized" });
        return;
    }
    if (!roleHasPermission(role, "logistics.po_approve_manager") &&
        !roleHasPermission(role, "logistics.po_approve_dg")) {
        res.status(403).json({ code: "forbidden" });
        return;
    }
    next();
}
const poLineSchema = z.object({
    itemId: z.string().min(1).max(80),
    qtyOrdered: z.number().positive(),
    unitCostCdfEst: z.number().int().min(0).max(999_999_999).optional().default(0),
});
function assertSupplierActive(id) {
    return !!db.prepare("SELECT 1 FROM stock_suppliers WHERE id = ? AND active = 1").get(id);
}
function assertItemActive(id) {
    return !!db.prepare("SELECT 1 FROM stock_items WHERE id = ? AND active = 1").get(id);
}
function routeParamId(raw) {
    if (raw === undefined)
        return "";
    return Array.isArray(raw) ? (raw[0] ?? "") : raw;
}
/** Numéro BC automatique : BC-{année}-{séquence sur 4 chiffres}, ex. BC-2026-0001 */
function generateNextPurchaseOrderExternalRef() {
    const year = new Date().getFullYear();
    const prefix = `BC-${year}-`;
    const rows = db.prepare(`SELECT external_ref AS r FROM stock_purchase_orders WHERE external_ref LIKE ?`).all(`${prefix}%`);
    let max = 0;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped}(\\d+)$`);
    for (const row of rows) {
        const m = typeof row.r === "string" ? row.r.match(re) : null;
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n))
                max = Math.max(max, n);
        }
    }
    return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
/** Lorsque Manager et DG ont tous deux visé (ordre quelconque) : en attente de paiement livre de caisse. */
function syncPoToPendingPaymentIfBothApproved(poId) {
    const row = db
        .prepare(`SELECT manager_approved_by_user_id AS m, dg_approved_by_user_id AS d, status
       FROM stock_purchase_orders WHERE id = ?`)
        .get(poId);
    if (!row?.m || !row?.d || row.m === row.d)
        return;
    if (row.status !== "submitted")
        return;
    db.prepare(`UPDATE stock_purchase_orders SET status = 'pending_payment' WHERE id = ?`).run(poId);
}
function loadPoDetail(poId) {
    const po = db
        .prepare(`SELECT p.id, p.supplier_id AS supplierId, p.status, p.note, p.external_ref AS externalRef,
 p.created_at AS createdAt, p.created_by_user_id AS createdByUserId,
              p.submitted_at AS submittedAt,
              p.manager_approved_by_user_id AS managerApprovedByUserId,
              p.manager_approved_at AS managerApprovedAt,
              p.dg_approved_by_user_id AS dgApprovedByUserId,
              p.dg_approved_at AS dgApprovedAt,
              p.finance_released_by_user_id AS financeReleasedByUserId,
              p.finance_released_at AS financeReleasedAt,
              p.finance_funding_detail AS financeFundingDetail,
              p.accounting_released_by_user_id AS accountingReleasedByUserId,
              p.accounting_released_at AS accountingReleasedAt,
              p.accounting_funding_detail AS accountingFundingDetail,
              p.supplier_payment_recorded_at AS supplierPaymentRecordedAt,
              p.supplier_payment_movement_id AS supplierPaymentMovementId,
              p.rejected_by_user_id AS rejectedByUserId, p.rejected_at AS rejectedAt, p.rejection_note AS rejectionNote,
              s.name AS supplierName,
              uc.name AS createdByName,
              um.name AS managerApprovedByName,
              ud.name AS dgApprovedByName,
              uf.name AS financeReleasedByName,
              ua.name AS accountingReleasedByName,
              ur.name AS rejectedByName
       FROM stock_purchase_orders p
       JOIN stock_suppliers s ON s.id = p.supplier_id
       LEFT JOIN users uc ON uc.id = p.created_by_user_id
       LEFT JOIN users um ON um.id = p.manager_approved_by_user_id
       LEFT JOIN users ud ON ud.id = p.dg_approved_by_user_id
       LEFT JOIN users uf ON uf.id = p.finance_released_by_user_id
       LEFT JOIN users ua ON ua.id = p.accounting_released_by_user_id
       LEFT JOIN users ur ON ur.id = p.rejected_by_user_id
       WHERE p.id = ?`)
        .get(poId);
    if (!po)
        return null;
    const lines = db
        .prepare(`SELECT l.id, l.item_id AS itemId, l.qty_ordered AS qtyOrdered, l.unit_cost_cdf_est AS unitCostCdfEst,
              l.sort_order AS sortOrder, i.code AS itemCode, i.label AS itemLabel, i.unit AS itemUnit
       FROM stock_purchase_order_lines l
       JOIN stock_items i ON i.id = l.item_id
       WHERE l.purchase_order_id = ?
       ORDER BY l.sort_order ASC, l.id ASC`)
        .all(poId);
    const estimatedTotalCdf = lines.reduce((s, ln) => s + Math.round(ln.qtyOrdered * ln.unitCostCdfEst), 0);
    return {
        ...po,
        estimatedTotalCdf,
        lines: lines.map((ln) => {
            const qtyReceived = getQtyReceivedForPurchaseOrderItem(poId, ln.itemId);
            return {
                id: ln.id,
                itemId: ln.itemId,
                itemCode: ln.itemCode,
                itemLabel: ln.itemLabel,
                itemUnit: ln.itemUnit,
                qtyOrdered: ln.qtyOrdered,
                qtyReceived,
                qtyRemaining: Math.max(0, ln.qtyOrdered - qtyReceived),
                unitCostCdfEst: ln.unitCostCdfEst,
                sortOrder: ln.sortOrder,
            };
        }),
    };
}
export function inventoryPurchaseOrderRoutes() {
    const r = createRouter();
    r.get("/purchase-orders", requireAuth, poReaderPerm, (req, res) => {
        const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
        const conds = ["1=1"];
        const params = [];
        if (status &&
            ["draft", "submitted", "pending_payment", "approved", "rejected", "closed"].includes(status)) {
            conds.push("p.status = ?");
            params.push(status);
        }
        const rows = db
            .prepare(`SELECT p.id, p.status, p.external_ref AS externalRef, p.created_at AS createdAt,
                p.submitted_at AS submittedAt, s.name AS supplierName,
                p.manager_approved_at AS managerApprovedAt, p.dg_approved_at AS dgApprovedAt,
                p.finance_released_at AS financeReleasedAt, p.accounting_released_at AS accountingReleasedAt,
                p.supplier_payment_recorded_at AS supplierPaymentRecordedAt,
                (SELECT IFNULL(CAST(ROUND(SUM(l.qty_ordered * l.unit_cost_cdf_est)) AS INTEGER), 0)
                   FROM stock_purchase_order_lines l WHERE l.purchase_order_id = p.id) AS estimatedTotalCdf
         FROM stock_purchase_orders p
         JOIN stock_suppliers s ON s.id = p.supplier_id
         WHERE ${conds.join(" AND ")}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 200`)
            .all(...params);
        res.json({ purchaseOrders: rows });
    });
    r.get("/purchase-orders/eligible-for-receipt", requireAuth, logisticsPerm, (_req, res) => {
        const pos = db
            .prepare(`SELECT p.id, p.external_ref AS externalRef, p.supplier_id AS supplierId, s.name AS supplierName
         FROM stock_purchase_orders p
         JOIN stock_suppliers s ON s.id = p.supplier_id
         WHERE p.status = 'approved'
         ORDER BY p.created_at DESC`)
            .all();
        const out = [];
        for (const po of pos) {
            const detail = loadPoDetail(po.id);
            if (!detail)
                continue;
            const hasRemaining = detail.lines.some((l) => l.qtyRemaining > 1e-9);
            if (hasRemaining) {
                out.push({
                    id: detail.id,
                    externalRef: detail.externalRef,
                    supplierId: detail.supplierId,
                    supplierName: detail.supplierName,
                    estimatedTotalCdf: detail.estimatedTotalCdf,
                    lines: detail.lines.filter((l) => l.qtyRemaining > 1e-9),
                });
            }
        }
        res.json({ purchaseOrders: out });
    });
    r.get("/purchase-orders/:id", requireAuth, poReaderPerm, (req, res) => {
        const detail = loadPoDetail(routeParamId(req.params.id));
        if (!detail) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        res.json({ purchaseOrder: detail });
    });
    /** Un seul paiement fournisseur total (CDF) : dépense livre de caisse + verrou sur le bon. */
    r.post("/purchase-orders/:id/supplier-payment", requireAuth, cashBookPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const bodySchema = z.object({
            occurredAt: z.string().min(10).max(40),
            sourceAccountId: z.string().min(1).max(80),
            note: z.string().max(1000).optional().default(""),
        });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const userId = req.auth?.sub ?? null;
        const txResult = db.transaction((pid: string) => {
            const row = db
                .prepare(`SELECT p.id, p.status, p.external_ref AS externalRef, s.name AS supplierName,
         p.supplier_payment_recorded_at AS spr
         FROM stock_purchase_orders p
         JOIN stock_suppliers s ON s.id = p.supplier_id
         WHERE p.id = ?`)
                .get(pid);
            if (!row)
                return { type: "not_found" };
            if (row.status !== "approved" && row.status !== "pending_payment")
                return { type: "invalid_status" };
            if (row.spr)
                return { type: "already_paid" };
            const lineSum = db
                .prepare(`SELECT IFNULL(CAST(ROUND(SUM(l.qty_ordered * l.unit_cost_cdf_est)) AS INTEGER), 0) AS t
         FROM stock_purchase_order_lines l WHERE l.purchase_order_id = ?`)
                .get(pid);
            const amount = lineSum?.t ?? 0;
            if (amount < 1)
                return { type: "zero_total" };
            const ref = row.externalRef || pid.slice(0, 8);
            const noteParts = [`Bon de commande ${ref}`, row.supplierName, `id ${pid}`];
            const extra = parsed.data.note.trim();
            if (extra)
                noteParts.push(extra);
            const ins = insertFinanceCashExpense({
                userId,
                occurredAt: parsed.data.occurredAt,
                sourceAccountId: parsed.data.sourceAccountId,
                amount,
                currency: "CDF",
                label: `Paiement fournisseur · ${ref}`,
                note: noteParts.join(" · "),
            });
            if (!ins.ok)
                return { type: "finance", fin: ins };
            const pendingPay = row.status === "pending_payment";
            const u = db
                .prepare(`UPDATE stock_purchase_orders
         SET supplier_payment_recorded_at = datetime('now'),
             supplier_payment_movement_id = @mid
             ${pendingPay ? ", status = 'approved'" : ""}
         WHERE id = @id AND supplier_payment_recorded_at IS NULL`)
                .run({ mid: ins.id, id: pid });
            if (u.changes !== 1) {
                db.prepare(`DELETE FROM finance_cash_movements WHERE id = ?`).run(ins.id);
                return { type: "already_paid" };
            }
            return { type: "ok", movementId: ins.id };
        })(poId);
        if (txResult.type === "not_found") {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (txResult.type === "invalid_status") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        if (txResult.type === "already_paid") {
            res.status(400).json({ code: "already_paid" });
            return;
        }
        if (txResult.type === "zero_total") {
            res.status(400).json({ code: "zero_total" });
            return;
        }
        if (txResult.type === "finance") {
            const f = txResult.fin;
            res.status(400).json({ code: f.code, field: f.field, hint: f.hint });
            return;
        }
        const detail = loadPoDetail(poId);
        res.status(201).json({ purchaseOrder: detail, movementId: txResult.movementId });
    });
    r.post("/purchase-orders", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            supplierId: z.string().min(1).max(80),
            /** Ignoré à la création : le serveur attribue BC-{année}-{n°}. */
            externalRef: z.string().max(120).optional().default(""),
            note: z.string().max(2000).optional().default(""),
            lines: z.array(poLineSchema).min(1).max(300),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        if (!assertSupplierActive(parsed.data.supplierId)) {
            res.status(400).json({ code: "unknown_supplier" });
            return;
        }
        const itemIds = new Set();
        for (const ln of parsed.data.lines) {
            if (itemIds.has(ln.itemId)) {
                res.status(400).json({ code: "duplicate_item" });
                return;
            }
            itemIds.add(ln.itemId);
            if (!assertItemActive(ln.itemId)) {
                res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                return;
            }
        }
        const id = randomUUID();
        const userId = req.auth?.sub ?? null;
        const externalRef = generateNextPurchaseOrderExternalRef();
        try {
            db.transaction(() => {
                db.prepare(`INSERT INTO stock_purchase_orders (id, supplier_id, status, note, external_ref, created_by_user_id)
           VALUES (?, ?, 'draft', ?, ?, ?)`).run(id, parsed.data.supplierId, parsed.data.note.trim(), externalRef, userId);
                const ins = db.prepare(`INSERT INTO stock_purchase_order_lines (id, purchase_order_id, item_id, qty_ordered, unit_cost_cdf_est, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`);
                parsed.data.lines.forEach((ln, i) => {
                    ins.run(randomUUID(), id, ln.itemId, ln.qtyOrdered, ln.unitCostCdfEst, i);
                });
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "insert_failed" });
            return;
        }
        res.status(201).json({ id });
    });
    r.patch("/purchase-orders/:id", requireAuth, logisticsPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const row = db.prepare("SELECT status FROM stock_purchase_orders WHERE id = ?").get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "draft") {
            res.status(400).json({ code: "not_editable" });
            return;
        }
        const schema = z.object({
            supplierId: z.string().min(1).max(80).optional(),
            externalRef: z.string().max(120).optional(),
            note: z.string().max(2000).optional(),
            lines: z.array(poLineSchema).min(1).max(300).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const cur = db
            .prepare(`SELECT supplier_id, note, external_ref FROM stock_purchase_orders WHERE id = ?`)
            .get(poId);
        const supplierId = parsed.data.supplierId ?? cur.supplier_id;
        if (!assertSupplierActive(supplierId)) {
            res.status(400).json({ code: "unknown_supplier" });
            return;
        }
        if (parsed.data.lines) {
            const itemIds = new Set();
            for (const ln of parsed.data.lines) {
                if (itemIds.has(ln.itemId)) {
                    res.status(400).json({ code: "duplicate_item" });
                    return;
                }
                itemIds.add(ln.itemId);
                if (!assertItemActive(ln.itemId)) {
                    res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                    return;
                }
            }
        }
        const note = parsed.data.note !== undefined ? parsed.data.note.trim() : cur.note;
        const externalRef = parsed.data.externalRef !== undefined ? parsed.data.externalRef.trim() : cur.external_ref;
        try {
            db.transaction(() => {
                db.prepare(`UPDATE stock_purchase_orders SET supplier_id = ?, note = ?, external_ref = ? WHERE id = ?`).run(supplierId, note, externalRef, poId);
                if (parsed.data.lines) {
                    db.prepare(`DELETE FROM stock_purchase_order_lines WHERE purchase_order_id = ?`).run(poId);
                    const ins = db.prepare(`INSERT INTO stock_purchase_order_lines (id, purchase_order_id, item_id, qty_ordered, unit_cost_cdf_est, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`);
                    parsed.data.lines.forEach((ln, i) => {
                        ins.run(randomUUID(), poId, ln.itemId, ln.qtyOrdered, ln.unitCostCdfEst, i);
                    });
                }
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "update_failed" });
            return;
        }
        const detail = loadPoDetail(poId);
        res.json({ purchaseOrder: detail });
    });
    r.patch("/purchase-orders/:id/approver-lines", requireAuth, approverLinesPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const row = db.prepare("SELECT status FROM stock_purchase_orders WHERE id = ?").get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "submitted" && row.status !== "pending_payment") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        const schema = z.object({ lines: z.array(poLineSchema).min(1).max(300) });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const itemIds = new Set();
        for (const ln of parsed.data.lines) {
            if (itemIds.has(ln.itemId)) {
                res.status(400).json({ code: "duplicate_item" });
                return;
            }
            itemIds.add(ln.itemId);
            if (!assertItemActive(ln.itemId)) {
                res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                return;
            }
        }
        try {
            db.transaction(() => {
                db.prepare(`DELETE FROM stock_purchase_order_lines WHERE purchase_order_id = ?`).run(poId);
                const ins = db.prepare(`INSERT INTO stock_purchase_order_lines (id, purchase_order_id, item_id, qty_ordered, unit_cost_cdf_est, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`);
                parsed.data.lines.forEach((ln, i) => {
                    ins.run(randomUUID(), poId, ln.itemId, ln.qtyOrdered, ln.unitCostCdfEst, i);
                });
                db.prepare(`UPDATE stock_purchase_orders SET
              status = 'submitted',
              manager_approved_by_user_id = NULL,
              manager_approved_at = NULL,
              dg_approved_by_user_id = NULL,
              dg_approved_at = NULL,
              finance_released_by_user_id = NULL,
              finance_released_at = NULL,
              finance_funding_detail = '',
              accounting_released_by_user_id = NULL,
              accounting_released_at = NULL,
              accounting_funding_detail = ''
            WHERE id = ?`).run(poId);
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "update_failed" });
            return;
        }
        res.json({ purchaseOrder: loadPoDetail(poId) });
    });
    r.post("/purchase-orders/:id/submit", requireAuth, logisticsPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const row = db.prepare("SELECT status FROM stock_purchase_orders WHERE id = ?").get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "draft") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        const n = db.prepare(`SELECT COUNT(*) AS c FROM stock_purchase_order_lines WHERE purchase_order_id = ?`).get(poId).c;
        if (n === 0) {
            res.status(400).json({ code: "no_lines" });
            return;
        }
        db.prepare(`UPDATE stock_purchase_orders SET status = 'submitted', submitted_at = datetime('now'),
 manager_approved_by_user_id = NULL, manager_approved_at = NULL,
       dg_approved_by_user_id = NULL, dg_approved_at = NULL,
       finance_released_by_user_id = NULL, finance_released_at = NULL,
       finance_funding_detail = '',
       accounting_released_by_user_id = NULL, accounting_released_at = NULL,
       accounting_funding_detail = '',
       rejected_by_user_id = NULL, rejected_at = NULL, rejection_note = ''
       WHERE id = ?`).run(poId);
        const detail = loadPoDetail(poId);
        res.json({ purchaseOrder: detail });
    });
    r.post("/purchase-orders/:id/approve-manager", requireAuth, approveManagerPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const userId = req.auth?.sub;
        if (!userId) {
            res.status(401).json({ code: "unauthorized" });
            return;
        }
        const row = db
            .prepare(`SELECT status, manager_approved_by_user_id, dg_approved_by_user_id FROM stock_purchase_orders WHERE id = ?`)
            .get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "submitted") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        if (row.manager_approved_by_user_id) {
            res.status(400).json({ code: "already_approved" });
            return;
        }
        if (row.dg_approved_by_user_id === userId) {
            res.status(400).json({ code: "same_approver" });
            return;
        }
        db.prepare(`UPDATE stock_purchase_orders SET manager_approved_by_user_id = ?, manager_approved_at = datetime('now') WHERE id = ?`).run(userId, poId);
        syncPoToPendingPaymentIfBothApproved(poId);
        res.json({ purchaseOrder: loadPoDetail(poId) });
    });
    r.post("/purchase-orders/:id/approve-dg", requireAuth, approveDgPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const userId = req.auth?.sub;
        if (!userId) {
            res.status(401).json({ code: "unauthorized" });
            return;
        }
        const row = db
            .prepare(`SELECT status, manager_approved_by_user_id, dg_approved_by_user_id FROM stock_purchase_orders WHERE id = ?`)
            .get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "submitted") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        if (row.dg_approved_by_user_id) {
            res.status(400).json({ code: "already_approved" });
            return;
        }
        if (row.manager_approved_by_user_id === userId) {
            res.status(400).json({ code: "same_approver" });
            return;
        }
        db.prepare(`UPDATE stock_purchase_orders SET dg_approved_by_user_id = ?, dg_approved_at = datetime('now') WHERE id = ?`).run(userId, poId);
        syncPoToPendingPaymentIfBothApproved(poId);
        res.json({ purchaseOrder: loadPoDetail(poId) });
    });
    r.post("/purchase-orders/:id/release-finance", requireAuth, poReaderPerm, (_req, res) => {
        res.status(410).json({
            code: "po_finance_steps_removed",
            message: "Les validations Finance / Compta ne s’appliquent plus : le bon passe en attente de paiement après les visas Manager et Direction générale.",
        });
    });
    r.post("/purchase-orders/:id/release-accounting", requireAuth, poReaderPerm, (_req, res) => {
        res.status(410).json({
            code: "po_finance_steps_removed",
            message: "Les validations Finance / Compta ne s’appliquent plus : le bon passe en attente de paiement après les visas Manager et Direction générale.",
        });
    });
    r.post("/purchase-orders/:id/reject", requireAuth, requireRejectPurchaseOrder, (req, res) => {
        const schema = z.object({ note: z.string().max(2000).optional().default("") });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const poId = routeParamId(req.params.id);
        const userId = req.auth?.sub;
        if (!userId) {
            res.status(401).json({ code: "unauthorized" });
            return;
        }
        const row = db.prepare("SELECT status FROM stock_purchase_orders WHERE id = ?").get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "submitted" && row.status !== "pending_payment") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        db.prepare(`UPDATE stock_purchase_orders SET status = 'rejected',
       rejected_by_user_id = ?, rejected_at = datetime('now'), rejection_note = ?,
       manager_approved_by_user_id = NULL, manager_approved_at = NULL,
       dg_approved_by_user_id = NULL, dg_approved_at = NULL,
       finance_released_by_user_id = NULL, finance_released_at = NULL,
       finance_funding_detail = '',
       accounting_released_by_user_id = NULL, accounting_released_at = NULL,
       accounting_funding_detail = ''
       WHERE id = ?`).run(userId, parsed.data.note.trim(), poId);
        res.json({ purchaseOrder: loadPoDetail(poId) });
    });
    r.post("/purchase-orders/:id/reopen", requireAuth, logisticsPerm, (req, res) => {
        const poId = routeParamId(req.params.id);
        const row = db.prepare("SELECT status FROM stock_purchase_orders WHERE id = ?").get(poId);
        if (!row) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        if (row.status !== "rejected") {
            res.status(400).json({ code: "invalid_status" });
            return;
        }
        db.prepare(`UPDATE stock_purchase_orders SET status = 'draft',
       submitted_at = NULL,
       rejected_by_user_id = NULL, rejected_at = NULL, rejection_note = '',
       manager_approved_by_user_id = NULL, manager_approved_at = NULL,
       dg_approved_by_user_id = NULL, dg_approved_at = NULL,
       finance_released_by_user_id = NULL, finance_released_at = NULL,
       finance_funding_detail = '',
       accounting_released_by_user_id = NULL, accounting_released_at = NULL,
       accounting_funding_detail = ''
       WHERE id = ?`).run(poId);
        res.json({ purchaseOrder: loadPoDetail(poId) });
    });
    return r;
}

// @ts-nocheck

import { randomUUID } from "node:crypto";
import { Router as createRouter } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { getQtyReceivedForPurchaseOrderItem, maybeClosePurchaseOrderIfComplete } from "../inventoryPoShared.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { STOCK_REF_CODE_RE, normalizeStockRefCode } from "../stockRefCodes.js";
const logisticsPerm = requireAnyPermission("logistics.inventory");
const stockItemsReaderPerm = requireAnyPermission("logistics.inventory", "logistics.po_approve_manager", "logistics.po_approve_dg");
const STOCK_ITEM_ROW_SELECT = `SELECT i.id, i.code, i.label, i.unit, i.unit_qty AS unitQty, i.category,
  i.subcategory AS subcategory, i.active,
  i.avg_cost_cdf AS avgCostCdf, i.sale_price_usd_cents AS salePriceUsdCents, i.created_at AS createdAt,
  COALESCE(uc.label, i.unit) AS unitLabel,
  COALESCE(cc.label, i.category) AS categoryLabel,
  CASE WHEN i.subcategory IS NOT NULL AND trim(i.subcategory) != ''
    THEN COALESCE(sc.label, i.subcategory) END AS subcategoryLabel
  FROM stock_items i
  LEFT JOIN stock_item_units uc ON uc.code = i.unit
  LEFT JOIN stock_item_categories cc ON cc.code = i.category
  LEFT JOIN stock_item_subcategories sc ON sc.code = i.subcategory AND sc.category_code = i.category`;
function categoryCodeActive(code) {
    return !!db.prepare("SELECT 1 FROM stock_item_categories WHERE code = ? AND active = 1").get(code);
}
/** Retourne le code normalisé ou "" si absent ; null si référentiel invalide. */
function subcategoryCodeForCategory(subRaw, categoryCode) {
    const sub = normalizeStockRefCode(subRaw || "");
    if (!sub)
        return "";
    const ok = db
        .prepare("SELECT 1 FROM stock_item_subcategories WHERE code = ? AND category_code = ? AND active = 1")
        .get(sub, categoryCode);
    return ok ? sub : null;
}
function unitCodeActive(code) {
    return !!db.prepare("SELECT 1 FROM stock_item_units WHERE code = ? AND active = 1").get(code);
}
const lineReceipt = z.object({
    itemId: z.string().min(1).max(80),
    qty: z.number().positive(),
    unitCostCdf: z.number().int().min(0).max(999_999_999),
});
const lineTransfer = z.object({
    itemId: z.string().min(1).max(80),
    qty: z.number().positive(),
});
const lineAdjustment = z.object({
    itemId: z.string().min(1).max(80),
    qtyDelta: z.number(),
});
const lineInventory = z.object({
    itemId: z.string().min(1).max(80),
    countedQty: z.number().min(0),
});
function getBalance(itemId, locationId) {
    const row = db
        .prepare(`SELECT COALESCE(SUM(qty_delta), 0) AS q FROM stock_movements WHERE item_id = ? AND location_id = ?`)
        .get(itemId, locationId);
    return Number(row.q);
}
function getTotalQtyItem(itemId) {
    const row = db
        .prepare(`SELECT COALESCE(SUM(qty_delta), 0) AS q FROM stock_movements WHERE item_id = ?`)
        .get(itemId);
    return Number(row.q);
}
function updateAvgCostFromReceipt(itemId, lines) {
    if (lines.length === 0)
        return;
    const addedQty = lines.reduce((s, l) => s + l.qty, 0);
    const addedValue = lines.reduce((s, l) => s + l.qty * l.unitCostCdf, 0);
    const oldTotal = getTotalQtyItem(itemId);
    const itemRow = db.prepare("SELECT avg_cost_cdf FROM stock_items WHERE id = ?").get(itemId);
    if (!itemRow)
        return;
    const oldAvg = Number(itemRow.avg_cost_cdf);
    const newTotal = oldTotal + addedQty;
    const newAvg = newTotal <= 0 ? oldAvg : Math.round((oldTotal * oldAvg + addedValue) / newTotal);
    db.prepare("UPDATE stock_items SET avg_cost_cdf = ? WHERE id = ?").run(newAvg, itemId);
}
function locationIsDepot(id) {
    const row = db.prepare("SELECT kind FROM stock_locations WHERE id = ? AND active = 1").get(id);
    return row?.kind === "depot";
}
function assertItemExists(id) {
    return !!db.prepare("SELECT 1 FROM stock_items WHERE id = ? AND active = 1").get(id);
}
function assertLocationExists(id) {
    return !!db.prepare("SELECT 1 FROM stock_locations WHERE id = ? AND active = 1").get(id);
}
function assertItemRowExists(id) {
    return !!db.prepare("SELECT 1 FROM stock_items WHERE id = ?").get(id);
}
function assertLocationRowExists(id) {
    return !!db.prepare("SELECT 1 FROM stock_locations WHERE id = ?").get(id);
}
function routeParamId(raw) {
    if (raw === undefined)
        return "";
    return Array.isArray(raw) ? (raw[0] ?? "") : raw;
}
const putReorderPoliciesSchema = z
    .object({
    policies: z
        .array(z.object({
        itemId: z.string().min(1).max(80),
        locationId: z.string().min(1).max(80),
        minQty: z.number().min(0).max(1e12).nullable(),
        maxQty: z.number().min(0).max(1e12).nullable(),
        reorderPoint: z.number().min(0).max(1e12).nullable(),
    }))
        .max(500),
})
    .superRefine((data, ctx) => {
    for (let i = 0; i < data.policies.length; i++) {
        const p = data.policies[i];
        if (p.minQty != null && p.maxQty != null && p.maxQty < p.minQty) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "max_below_min",
                path: ["policies", i, "maxQty"],
            });
        }
        if (p.reorderPoint != null && p.minQty != null && p.reorderPoint < p.minQty) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "reorder_below_min",
                path: ["policies", i, "reorderPoint"],
            });
        }
    }
});
export function inventoryRoutes() {
    const r = createRouter();
    r.get("/locations", requireAuth, logisticsPerm, (_req, res) => {
        const rows = db
            .prepare(`SELECT id, code, label, kind, sort_order AS sortOrder, active FROM stock_locations ORDER BY sort_order ASC, code ASC`)
            .all();
        res.json({
            locations: rows.map((x) => ({
                id: x.id,
                code: x.code,
                label: x.label,
                kind: x.kind,
                sortOrder: x.sortOrder,
                active: x.active === 1,
            })),
        });
    });
    r.get("/article-refs", requireAuth, logisticsPerm, (_req, res) => {
        const categories = db
            .prepare(`SELECT code, label, sort_order AS sortOrder FROM stock_item_categories WHERE active = 1 ORDER BY sort_order ASC, code ASC`)
            .all();
        const units = db
            .prepare(`SELECT code, label, sort_order AS sortOrder FROM stock_item_units WHERE active = 1 ORDER BY sort_order ASC, code ASC`)
            .all();
        const subcategories = db
            .prepare(`SELECT code, category_code AS categoryCode, label, sort_order AS sortOrder FROM stock_item_subcategories WHERE active = 1 ORDER BY category_code ASC, sort_order ASC, code ASC`)
            .all();
        res.json({ categories, units, subcategories });
    });
    r.get("/points-of-sale", requireAuth, logisticsPerm, (_req, res) => {
        const rows = db
            .prepare(`SELECT p.id, p.code, p.label, p.sort_order AS sortOrder, p.is_main AS isMain,
 p.stock_location_id AS stockLocationId, l.label AS stockLocationLabel
         FROM stock_points_of_sale p
         JOIN stock_locations l ON l.id = p.stock_location_id
         WHERE p.active = 1
         ORDER BY p.sort_order ASC, p.code ASC`)
            .all();
        res.json({
            pointsOfSale: rows.map((x) => ({
                id: x.id,
                code: x.code,
                label: x.label,
                sortOrder: x.sortOrder,
                isMain: x.isMain === 1,
                stockLocationId: x.stockLocationId,
                stockLocationLabel: x.stockLocationLabel,
            })),
        });
    });
    r.get("/items", requireAuth, stockItemsReaderPerm, (req, res) => {
        const activeOnly = req.query.active !== "0";
        const rows = db
            .prepare(activeOnly
            ? `${STOCK_ITEM_ROW_SELECT} WHERE i.active = 1 ORDER BY i.label COLLATE NOCASE ASC`
            : `${STOCK_ITEM_ROW_SELECT} ORDER BY i.label COLLATE NOCASE ASC`)
            .all();
        res.json({
            items: rows.map((x) => ({
                id: x.id,
                code: x.code,
                label: x.label,
                unit: x.unit,
                unitQty: Number(x.unitQty),
                unitLabel: x.unitLabel,
                category: x.category,
                categoryLabel: x.categoryLabel,
                subcategory: x.subcategory ?? "",
                subcategoryLabel: x.subcategoryLabel ?? null,
                active: x.active === 1,
                avgCostCdf: x.avgCostCdf,
                salePriceUsdCents: x.salePriceUsdCents,
                createdAt: x.createdAt,
            })),
        });
    });
    r.post("/items", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            label: z.string().min(1).max(200).trim(),
            unit: z.string().max(80).optional().default("unite"),
            category: z.string().max(80).optional().default("general"),
            subcategory: z.string().max(80).optional().default(""),
            unitQty: z.number().positive().max(1_000_000_000).optional().default(1),
            salePriceUsdCents: z.number().int().min(0).max(999_999_999).optional().default(0),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const unitCode = normalizeStockRefCode(parsed.data.unit || "unite");
        const catCode = normalizeStockRefCode(parsed.data.category || "general");
        if (!STOCK_REF_CODE_RE.test(unitCode) || !unitCodeActive(unitCode)) {
            res.status(400).json({ code: "invalid_unit" });
            return;
        }
        if (!STOCK_REF_CODE_RE.test(catCode) || !categoryCodeActive(catCode)) {
            res.status(400).json({ code: "invalid_category" });
            return;
        }
        const subResolved = subcategoryCodeForCategory(parsed.data.subcategory ?? "", catCode);
        if (subResolved === null) {
            res.status(400).json({ code: "invalid_subcategory" });
            return;
        }
        let id = randomUUID();
        let code = `CF-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
        let inserted = false;
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                db.prepare(`INSERT INTO stock_items (id, code, label, unit, unit_qty, category, subcategory, active, avg_cost_cdf, sale_price_usd_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`).run(id, code, parsed.data.label, unitCode, parsed.data.unitQty, catCode, subResolved, parsed.data.salePriceUsdCents);
                inserted = true;
                break;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg.includes("UNIQUE") && attempt < 11) {
                    id = randomUUID();
                    code = `CF-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
                    continue;
                }
                res.status(500).json({ code: "insert_failed" });
                return;
            }
        }
        if (!inserted) {
            res.status(500).json({ code: "code_generation_failed" });
            return;
        }
        const row = db.prepare(`${STOCK_ITEM_ROW_SELECT} WHERE i.id = ?`).get(id);
        res.status(201).json({
            item: {
                id: row.id,
                code: row.code,
                label: row.label,
                unit: row.unit,
                unitQty: Number(row.unitQty),
                unitLabel: row.unitLabel,
                category: row.category,
                categoryLabel: row.categoryLabel,
                subcategory: row.subcategory ?? "",
                subcategoryLabel: row.subcategoryLabel ?? null,
                active: row.active === 1,
                avgCostCdf: row.avgCostCdf,
                salePriceUsdCents: row.salePriceUsdCents,
                createdAt: row.createdAt,
            },
        });
    });
    r.patch("/items/:id", requireAuth, logisticsPerm, (req, res) => {
        const id = routeParamId(req.params.id);
        const schema = z.object({
            label: z.string().min(1).max(200).trim().optional(),
            unit: z.string().max(80).trim().optional(),
            unitQty: z.number().positive().max(1_000_000_000).optional(),
            category: z.string().max(80).trim().optional(),
            subcategory: z.string().max(80).trim().optional(),
            active: z.boolean().optional(),
            salePriceUsdCents: z.number().int().min(0).max(999_999_999).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const exists = db.prepare("SELECT 1 FROM stock_items WHERE id = ?").get(id);
        if (!exists) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        const cur = db.prepare(`SELECT label, unit, unit_qty AS unitQty, category, subcategory, active, sale_price_usd_cents AS salePriceUsdCents FROM stock_items WHERE id = ?`).get(id);
        const label = parsed.data.label ?? cur.label;
        let unit = cur.unit;
        if (parsed.data.unit !== undefined) {
            const unitCode = normalizeStockRefCode(parsed.data.unit);
            if (!STOCK_REF_CODE_RE.test(unitCode) || !unitCodeActive(unitCode)) {
                res.status(400).json({ code: "invalid_unit" });
                return;
            }
            unit = unitCode;
        }
        let category = cur.category;
        if (parsed.data.category !== undefined) {
            const catCode = normalizeStockRefCode(parsed.data.category);
            if (!STOCK_REF_CODE_RE.test(catCode) || !categoryCodeActive(catCode)) {
                res.status(400).json({ code: "invalid_category" });
                return;
            }
            category = catCode;
        }
        let subcategory = cur.subcategory ?? "";
        if (parsed.data.subcategory !== undefined) {
            const subResolved = subcategoryCodeForCategory(parsed.data.subcategory, category);
            if (subResolved === null) {
                res.status(400).json({ code: "invalid_subcategory" });
                return;
            }
            subcategory = subResolved;
        }
        else if (parsed.data.category !== undefined && parsed.data.subcategory === undefined && subcategory) {
            const stillOk = subcategoryCodeForCategory(subcategory, category);
            if (stillOk === null) {
                subcategory = "";
            }
        }
        let unitQty = Number(cur.unitQty);
        if (parsed.data.unitQty !== undefined) {
            unitQty = parsed.data.unitQty;
        }
        const active = parsed.data.active !== undefined ? (parsed.data.active ? 1 : 0) : cur.active;
        let salePriceUsdCents = Number(cur.salePriceUsdCents);
        if (parsed.data.salePriceUsdCents !== undefined) {
            salePriceUsdCents = parsed.data.salePriceUsdCents;
        }
        db.prepare(`UPDATE stock_items SET label = ?, unit = ?, unit_qty = ?, category = ?, subcategory = ?, active = ?, sale_price_usd_cents = ? WHERE id = ?`).run(label, unit, unitQty, category, subcategory, active, salePriceUsdCents, id);
        const row = db.prepare(`${STOCK_ITEM_ROW_SELECT} WHERE i.id = ?`).get(id);
        res.json({
            item: {
                id: row.id,
                code: row.code,
                label: row.label,
                unit: row.unit,
                unitQty: Number(row.unitQty),
                unitLabel: row.unitLabel,
                category: row.category,
                categoryLabel: row.categoryLabel,
                subcategory: row.subcategory ?? "",
                subcategoryLabel: row.subcategoryLabel ?? null,
                active: row.active === 1,
                avgCostCdf: row.avgCostCdf,
                salePriceUsdCents: row.salePriceUsdCents,
                createdAt: row.createdAt,
            },
        });
    });
    r.delete("/items/:id", requireAuth, logisticsPerm, (req, res) => {
        const id = routeParamId(req.params.id);
        if (!id) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const exists = db.prepare("SELECT 1 FROM stock_items WHERE id = ?").get(id);
        if (!exists) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        const hasMovements = db.prepare("SELECT 1 FROM stock_movements WHERE item_id = ? LIMIT 1").get(id);
        if (hasMovements) {
            res.status(409).json({ code: "item_has_movements" });
            return;
        }
        const onPo = db.prepare("SELECT 1 FROM stock_purchase_order_lines WHERE item_id = ? LIMIT 1").get(id);
        if (onPo) {
            res.status(409).json({ code: "item_on_purchase_orders" });
            return;
        }
        try {
            db.prepare("DELETE FROM stock_items WHERE id = ?").run(id);
        }
        catch {
            res.status(409).json({ code: "item_in_use" });
            return;
        }
        res.status(204).end();
    });
    r.get("/balances", requireAuth, logisticsPerm, (_req, res) => {
        const rows = db
            .prepare(`SELECT m.item_id AS itemId, m.location_id AS locationId,
                COALESCE(SUM(m.qty_delta), 0) AS qty,
                i.code AS itemCode, i.label AS itemLabel, i.unit AS itemUnit, i.avg_cost_cdf AS avgCostCdf,
                l.code AS locationCode, l.label AS locationLabel, l.kind AS locationKind
         FROM stock_movements m
         JOIN stock_items i ON i.id = m.item_id
         JOIN stock_locations l ON l.id = m.location_id
         GROUP BY m.item_id, m.location_id
         HAVING ABS(qty) > 1e-9
         ORDER BY l.sort_order ASC, i.label COLLATE NOCASE ASC`)
            .all();
        res.json({
            balances: rows.map((x) => ({
                itemId: x.itemId,
                locationId: x.locationId,
                qty: x.qty,
                itemCode: x.itemCode,
                itemLabel: x.itemLabel,
                itemUnit: x.itemUnit,
                avgCostCdf: x.avgCostCdf,
                locationCode: x.locationCode,
                locationLabel: x.locationLabel,
                locationKind: x.locationKind,
            })),
        });
    });
    r.get("/suppliers", requireAuth, logisticsPerm, (_req, res) => {
        const rows = db
            .prepare(`SELECT id, name, phone, email, notes, address, lead_time_days AS leadTimeDays, active, created_at AS createdAt
         FROM stock_suppliers WHERE active = 1 ORDER BY name COLLATE NOCASE ASC`)
            .all();
        res.json({
            suppliers: rows.map((x) => ({
                id: x.id,
                name: x.name,
                phone: x.phone,
                email: x.email,
                notes: x.notes,
                address: x.address ?? "",
                leadTimeDays: x.leadTimeDays ?? null,
                active: x.active === 1,
                createdAt: x.createdAt,
            })),
        });
    });
    r.post("/suppliers", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            name: z.string().min(1).max(200).trim(),
            phone: z.string().max(80).optional().default(""),
            email: z.string().max(200).optional().default(""),
            notes: z.string().max(2000).optional().default(""),
            address: z.string().max(500).optional().default(""),
            leadTimeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const id = randomUUID();
        const lt = parsed.data.leadTimeDays === undefined ? null : parsed.data.leadTimeDays;
        db.prepare(`INSERT INTO stock_suppliers (id, name, phone, email, notes, address, lead_time_days, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(
            id,
            parsed.data.name,
            parsed.data.phone.trim(),
            parsed.data.email.trim(),
            parsed.data.notes.trim(),
            parsed.data.address.trim(),
            lt,
        );
        const row = db
            .prepare(`SELECT id, name, phone, email, notes, address, lead_time_days AS leadTimeDays, active, created_at AS createdAt FROM stock_suppliers WHERE id = ?`)
            .get(id);
        res.status(201).json({
            supplier: {
                id: row.id,
                name: row.name,
                phone: row.phone,
                email: row.email,
                notes: row.notes,
                address: row.address ?? "",
                leadTimeDays: row.leadTimeDays ?? null,
                active: row.active === 1,
                createdAt: row.createdAt,
            },
        });
    });
    r.patch("/suppliers/:id", requireAuth, logisticsPerm, (req, res) => {
        const id = routeParamId(req.params.id);
        const schema = z.object({
            name: z.string().min(1).max(200).trim().optional(),
            phone: z.string().max(80).optional(),
            email: z.string().max(200).optional(),
            notes: z.string().max(2000).optional(),
            address: z.string().max(500).optional(),
            leadTimeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
            active: z.boolean().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const cur = db
            .prepare(`SELECT name, phone, email, notes, address, lead_time_days AS leadTimeDays, active FROM stock_suppliers WHERE id = ?`)
            .get(id);
        if (!cur) {
            res.status(404).json({ code: "not_found" });
            return;
        }
        const name = parsed.data.name ?? cur.name;
        const phone = parsed.data.phone !== undefined ? parsed.data.phone.trim() : cur.phone;
        const email = parsed.data.email !== undefined ? parsed.data.email.trim() : cur.email;
        const notes = parsed.data.notes !== undefined ? parsed.data.notes.trim() : cur.notes;
        const address = parsed.data.address !== undefined ? parsed.data.address.trim() : cur.address;
        const leadTimeDays = parsed.data.leadTimeDays !== undefined ? parsed.data.leadTimeDays : cur.leadTimeDays;
        const active = parsed.data.active !== undefined ? (parsed.data.active ? 1 : 0) : cur.active;
        db.prepare(`UPDATE stock_suppliers SET name = ?, phone = ?, email = ?, notes = ?, address = ?, lead_time_days = ?, active = ? WHERE id = ?`).run(
            name,
            phone,
            email,
            notes,
            address,
            leadTimeDays,
            active,
            id,
        );
        const row = db
            .prepare(`SELECT id, name, phone, email, notes, address, lead_time_days AS leadTimeDays, active, created_at AS createdAt FROM stock_suppliers WHERE id = ?`)
            .get(id);
        res.json({
            supplier: {
                id: row.id,
                name: row.name,
                phone: row.phone,
                email: row.email,
                notes: row.notes,
                address: row.address ?? "",
                leadTimeDays: row.leadTimeDays ?? null,
                active: row.active === 1,
                createdAt: row.createdAt,
            },
        });
    });
    r.get("/reorder-policies", requireAuth, logisticsPerm, (_req, res) => {
        const rows = db
            .prepare(`SELECT p.item_id AS itemId, p.location_id AS locationId,
                p.min_qty AS minQty, p.max_qty AS maxQty, p.reorder_point AS reorderPoint,
                i.code AS itemCode, i.label AS itemLabel,
                l.code AS locationCode, l.label AS locationLabel
         FROM stock_item_location_policies p
         JOIN stock_items i ON i.id = p.item_id
         JOIN stock_locations l ON l.id = p.location_id
         ORDER BY l.sort_order ASC, i.label COLLATE NOCASE ASC`)
            .all();
        res.json({
            policies: rows.map((x) => ({
                itemId: x.itemId,
                locationId: x.locationId,
                minQty: x.minQty,
                maxQty: x.maxQty,
                reorderPoint: x.reorderPoint,
                itemCode: x.itemCode,
                itemLabel: x.itemLabel,
                locationCode: x.locationCode,
                locationLabel: x.locationLabel,
            })),
        });
    });
    r.put("/reorder-policies", requireAuth, logisticsPerm, (req, res) => {
        const parsed = putReorderPoliciesSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const del = db.prepare(`DELETE FROM stock_item_location_policies WHERE item_id = ? AND location_id = ?`);
        const upsert = db.prepare(`
      INSERT INTO stock_item_location_policies (item_id, location_id, min_qty, max_qty, reorder_point)
      VALUES (@item_id, @location_id, @min_qty, @max_qty, @reorder_point)
      ON CONFLICT(item_id, location_id) DO UPDATE SET
        min_qty = excluded.min_qty,
        max_qty = excluded.max_qty,
        reorder_point = excluded.reorder_point
    `);
        try {
            const run = db.transaction(() => {
                for (const p of parsed.data.policies) {
                    const empty = p.minQty == null && p.maxQty == null && p.reorderPoint == null;
                    if (empty) {
                        del.run(p.itemId, p.locationId);
                        continue;
                    }
                    if (!assertItemRowExists(p.itemId) || !assertLocationRowExists(p.locationId)) {
                        throw new Error("invalid_ref");
                    }
                    upsert.run({
                        item_id: p.itemId,
                        location_id: p.locationId,
                        min_qty: p.minQty,
                        max_qty: p.maxQty,
                        reorder_point: p.reorderPoint,
                    });
                }
            });
            run();
        }
        catch (e) {
            if (e instanceof Error && e.message === "invalid_ref") {
                res.status(400).json({ code: "invalid_item_or_location" });
                return;
            }
            throw e;
        }
        res.json({ ok: true });
    });
    r.get("/stock-alerts", requireAuth, logisticsPerm, (_req, res) => {
        const rows = db
            .prepare(`SELECT p.item_id AS itemId, p.location_id AS locationId,
                p.min_qty AS minQty, p.max_qty AS maxQty, p.reorder_point AS reorderPoint,
                i.code AS itemCode, i.label AS itemLabel,
                l.label AS locationLabel,
                COALESCE((
                  SELECT SUM(m.qty_delta) FROM stock_movements m
                  WHERE m.item_id = p.item_id AND m.location_id = p.location_id
                ), 0) AS qty
         FROM stock_item_location_policies p
         JOIN stock_items i ON i.id = p.item_id AND i.active = 1
         JOIN stock_locations l ON l.id = p.location_id AND l.active = 1`)
            .all();
        const alerts = [];
        for (const row of rows) {
            const qty = Number(row.qty);
            if (row.maxQty != null && qty > row.maxQty) {
                alerts.push({
                    kind: "overstock",
                    severity: "warn",
                    itemId: row.itemId,
                    locationId: row.locationId,
                    itemCode: row.itemCode,
                    itemLabel: row.itemLabel,
                    locationLabel: row.locationLabel,
                    qty,
                    minQty: row.minQty,
                    maxQty: row.maxQty,
                    reorderPoint: row.reorderPoint,
                    message: `Sur-stock : ${row.itemCode} @ ${row.locationLabel} — ${qty} > plafond ${row.maxQty}.`,
                });
            }
            if (row.minQty != null && qty <= row.minQty) {
                alerts.push({
                    kind: "stockout",
                    severity: "warn",
                    itemId: row.itemId,
                    locationId: row.locationId,
                    itemCode: row.itemCode,
                    itemLabel: row.itemLabel,
                    locationLabel: row.locationLabel,
                    qty,
                    minQty: row.minQty,
                    maxQty: row.maxQty,
                    reorderPoint: row.reorderPoint,
                    message: `Rupture imminente / sous stock min : ${row.itemCode} @ ${row.locationLabel} — ${qty} (min ${row.minQty}).`,
                });
            }
            else if (row.reorderPoint != null && qty <= row.reorderPoint) {
                alerts.push({
                    kind: "reorder",
                    severity: "info",
                    itemId: row.itemId,
                    locationId: row.locationId,
                    itemCode: row.itemCode,
                    itemLabel: row.itemLabel,
                    locationLabel: row.locationLabel,
                    qty,
                    minQty: row.minQty,
                    maxQty: row.maxQty,
                    reorderPoint: row.reorderPoint,
                    message: `Point de commande atteint : ${row.itemCode} @ ${row.locationLabel} — ${qty} (point ${row.reorderPoint}).`,
                });
            }
        }
        alerts.sort((a, b) => {
            const ord = (k) => (k === "stockout" ? 0 : k === "overstock" ? 1 : 2);
            return ord(a.kind) - ord(b.kind) || a.itemLabel.localeCompare(b.itemLabel);
        });
        res.json({ alerts });
    });
    r.get("/to-order", requireAuth, logisticsPerm, (_req, res) => {
        const leadRow = db
            .prepare(`SELECT MAX(lead_time_days) AS maxLead
         FROM stock_suppliers WHERE active = 1 AND lead_time_days IS NOT NULL`)
            .get();
        const rows = db
            .prepare(`SELECT p.item_id AS itemId, p.location_id AS locationId,
                p.min_qty AS minQty, p.max_qty AS maxQty, p.reorder_point AS reorderPoint,
                i.code AS itemCode, i.label AS itemLabel, i.unit AS itemUnit,
                l.label AS locationLabel,
                COALESCE((
                  SELECT SUM(m.qty_delta) FROM stock_movements m
                  WHERE m.item_id = p.item_id AND m.location_id = p.location_id
                ), 0) AS qty
         FROM stock_item_location_policies p
         JOIN stock_items i ON i.id = p.item_id AND i.active = 1
         JOIN stock_locations l ON l.id = p.location_id AND l.active = 1`)
            .all();
        const lines = [];
        for (const row of rows) {
            const qty = Number(row.qty);
            const trigger = row.reorderPoint != null ? row.reorderPoint : row.minQty != null ? row.minQty : null;
            if (trigger == null)
                continue;
            if (qty > trigger)
                continue;
            let suggestedQty = 0;
            if (row.maxQty != null)
                suggestedQty = Math.max(0, row.maxQty - qty);
            else if (row.reorderPoint != null)
                suggestedQty = Math.max(0, 2 * row.reorderPoint - qty);
            else if (row.minQty != null)
                suggestedQty = Math.max(0, 2 * row.minQty - qty);
            lines.push({
                itemId: row.itemId,
                locationId: row.locationId,
                itemCode: row.itemCode,
                itemLabel: row.itemLabel,
                itemUnit: row.itemUnit,
                locationLabel: row.locationLabel,
                qty,
                minQty: row.minQty,
                maxQty: row.maxQty,
                reorderPoint: row.reorderPoint,
                triggerLevel: trigger,
                suggestedQty,
                supplierLeadDaysMax: leadRow.maxLead,
            });
        }
        lines.sort((a, b) => {
            const la = a.supplierLeadDaysMax ?? 0;
            const lb = b.supplierLeadDaysMax ?? 0;
            if (lb !== la)
                return lb - la;
            return a.qty - b.qty || a.itemLabel.localeCompare(b.itemLabel);
        });
        res.json({ lines, supplierLeadDaysMax: leadRow.maxLead });
    });
    r.get("/documents", requireAuth, logisticsPerm, (req, res) => {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
        const docs = db
            .prepare(`SELECT d.id, d.doc_type AS docType, d.supplier_id AS supplierId, d.from_location_id AS fromLocationId,
                d.to_location_id AS toLocationId, d.external_ref AS externalRef, d.note, d.created_at AS createdAt,
                d.created_by_user_id AS createdByUserId,
                d.purchase_order_id AS purchaseOrderId,
                u.name AS createdByName,
                s.name AS supplierName,
                po.external_ref AS purchaseOrderExternalRef
         FROM stock_documents d
         LEFT JOIN users u ON u.id = d.created_by_user_id
         LEFT JOIN stock_suppliers s ON s.id = d.supplier_id
         LEFT JOIN stock_purchase_orders po ON po.id = d.purchase_order_id
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT ?`)
            .all(limit);
        const locLabels = new Map();
        const locs = db.prepare(`SELECT id, label FROM stock_locations`).all();
        for (const l of locs)
            locLabels.set(l.id, l.label);
        const movements = docs.length === 0
            ? []
            : db
                .prepare(`SELECT m.document_id AS documentId, m.item_id AS itemId, m.location_id AS locationId,
                m.qty_delta AS qtyDelta, m.unit_cost_cdf AS unitCostCdf, m.ledger_kind AS ledgerKind,
                i.code AS itemCode, i.label AS itemLabel,
                l.label AS locationLabel
         FROM stock_movements m
         JOIN stock_items i ON i.id = m.item_id
         JOIN stock_locations l ON l.id = m.location_id
         WHERE m.document_id IN (${docs.map(() => "?").join(",")})
         ORDER BY m.created_at ASC, m.id ASC`)
                .all(...docs.map((d) => d.id));
        const byDoc = new Map();
        for (const m of movements) {
            const arr = byDoc.get(m.documentId) ?? [];
            arr.push(m);
            byDoc.set(m.documentId, arr);
        }
        res.json({
            documents: docs.map((d) => ({
                id: d.id,
                docType: d.docType,
                supplierId: d.supplierId,
                supplierName: d.supplierName,
                fromLocationId: d.fromLocationId,
                fromLocationLabel: d.fromLocationId ? locLabels.get(d.fromLocationId) ?? null : null,
                toLocationId: d.toLocationId,
                toLocationLabel: d.toLocationId ? locLabels.get(d.toLocationId) ?? null : null,
                externalRef: d.externalRef,
                note: d.note,
                createdAt: d.createdAt,
                createdByUserId: d.createdByUserId,
                createdByName: d.createdByName,
                purchaseOrderId: d.purchaseOrderId,
                purchaseOrderExternalRef: d.purchaseOrderExternalRef,
                movements: (byDoc.get(d.id) ?? []).map((m) => ({
                    itemId: m.itemId,
                    itemCode: m.itemCode,
                    itemLabel: m.itemLabel,
                    locationId: m.locationId,
                    locationLabel: m.locationLabel,
                    qtyDelta: m.qtyDelta,
                    unitCostCdf: m.unitCostCdf,
                    ledgerKind: m.ledgerKind,
                })),
            })),
        });
    });
    r.post("/documents/receipt", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            purchaseOrderId: z.string().min(1).max(80),
            toLocationId: z.string().min(1).max(80),
            externalRef: z.string().max(120).optional().default(""),
            note: z.string().max(2000).optional().default(""),
            lines: z.array(lineReceipt).min(1).max(200),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const { purchaseOrderId, toLocationId, externalRef, note, lines } = parsed.data;
        if (!assertLocationExists(toLocationId) || !locationIsDepot(toLocationId)) {
            res.status(400).json({ code: "invalid_depot" });
            return;
        }
        const poRow = db
            .prepare(`SELECT supplier_id AS supplierId, status FROM stock_purchase_orders WHERE id = ?`)
            .get(purchaseOrderId);
        if (!poRow) {
            res.status(400).json({ code: "unknown_purchase_order" });
            return;
        }
        if (poRow.status !== "approved") {
            res.status(400).json({ code: "po_not_approved" });
            return;
        }
        const supplierId = poRow.supplierId;
        for (const ln of lines) {
            if (!assertItemExists(ln.itemId)) {
                res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                return;
            }
        }
        const qtyIncomingByItem = new Map();
        for (const ln of lines) {
            qtyIncomingByItem.set(ln.itemId, (qtyIncomingByItem.get(ln.itemId) ?? 0) + ln.qty);
        }
        for (const [itemId, addQty] of qtyIncomingByItem) {
            const pol = db
                .prepare(`SELECT qty_ordered AS q FROM stock_purchase_order_lines WHERE purchase_order_id = ? AND item_id = ?`)
                .get(purchaseOrderId, itemId);
            if (!pol) {
                res.status(400).json({ code: "item_not_on_po", itemId });
                return;
            }
            const already = getQtyReceivedForPurchaseOrderItem(purchaseOrderId, itemId);
            if (already + addQty > pol.q + 1e-9) {
                res.status(400).json({
                    code: "qty_exceeds_po",
                    itemId,
                    ordered: pol.q,
                    alreadyReceived: already,
                    incoming: addQty,
                });
                return;
            }
        }
        const byItem = new Map();
        for (const ln of lines) {
            const arr = byItem.get(ln.itemId) ?? [];
            arr.push({ qty: ln.qty, unitCostCdf: ln.unitCostCdf });
            byItem.set(ln.itemId, arr);
        }
        const docId = randomUUID();
        const userId = req.auth?.sub ?? null;
        try {
            db.transaction(() => {
                for (const [itemId, aggLines] of byItem) {
                    updateAvgCostFromReceipt(itemId, aggLines);
                }
                db.prepare(`INSERT INTO stock_documents (id, doc_type, supplier_id, from_location_id, to_location_id, external_ref, note, created_by_user_id, purchase_order_id)
           VALUES (?, 'receipt', ?, NULL, ?, ?, ?, ?, ?)`).run(docId, supplierId, toLocationId, externalRef.trim(), note.trim(), userId, purchaseOrderId);
                const insM = db.prepare(`INSERT INTO stock_movements (id, document_id, item_id, location_id, qty_delta, unit_cost_cdf, ledger_kind)
           VALUES (?, ?, ?, ?, ?, ?, 'receipt')`);
                for (const ln of lines) {
                    insM.run(randomUUID(), docId, ln.itemId, toLocationId, ln.qty, ln.unitCostCdf);
                }
                maybeClosePurchaseOrderIfComplete(purchaseOrderId);
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "transaction_failed" });
            return;
        }
        res.status(201).json({ documentId: docId });
    });
    r.post("/documents/transfer", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            fromLocationId: z.string().min(1).max(80),
            toLocationId: z.string().min(1).max(80),
            note: z.string().max(2000).optional().default(""),
            lines: z.array(lineTransfer).min(1).max(200),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const { fromLocationId, toLocationId, note, lines } = parsed.data;
        if (fromLocationId === toLocationId) {
            res.status(400).json({ code: "same_location" });
            return;
        }
        if (!assertLocationExists(fromLocationId) || !assertLocationExists(toLocationId)) {
            res.status(400).json({ code: "unknown_location" });
            return;
        }
        for (const ln of lines) {
            if (!assertItemExists(ln.itemId)) {
                res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                return;
            }
            const avail = getBalance(ln.itemId, fromLocationId);
            if (avail + 1e-9 < ln.qty) {
                res.status(400).json({
                    code: "insufficient_stock",
                    itemId: ln.itemId,
                    available: avail,
                    requested: ln.qty,
                });
                return;
            }
        }
        const docId = randomUUID();
        const userId = req.auth?.sub ?? null;
        try {
            db.transaction(() => {
                db.prepare(`INSERT INTO stock_documents (id, doc_type, supplier_id, from_location_id, to_location_id, external_ref, note, created_by_user_id)
           VALUES (?, 'transfer', NULL, ?, ?, '', ?, ?)`).run(docId, fromLocationId, toLocationId, note.trim(), userId);
                const insM = db.prepare(`INSERT INTO stock_movements (id, document_id, item_id, location_id, qty_delta, unit_cost_cdf, ledger_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?)`);
                for (const ln of lines) {
                    const avgRow = db.prepare("SELECT avg_cost_cdf FROM stock_items WHERE id = ?").get(ln.itemId);
                    const uc = avgRow?.avg_cost_cdf ?? 0;
                    insM.run(randomUUID(), docId, ln.itemId, fromLocationId, -ln.qty, uc, "transfer_out");
                    insM.run(randomUUID(), docId, ln.itemId, toLocationId, ln.qty, uc, "transfer_in");
                }
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "transaction_failed" });
            return;
        }
        res.status(201).json({ documentId: docId });
    });
    r.post("/documents/adjustment", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            locationId: z.string().min(1).max(80),
            note: z.string().max(2000).optional().default(""),
            lines: z.array(lineAdjustment).min(1).max(200),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const { locationId, note, lines } = parsed.data;
        if (!assertLocationExists(locationId)) {
            res.status(400).json({ code: "unknown_location" });
            return;
        }
        for (const ln of lines) {
            if (!assertItemExists(ln.itemId)) {
                res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                return;
            }
            if (ln.qtyDelta < 0) {
                const avail = getBalance(ln.itemId, locationId);
                if (avail + 1e-9 < -ln.qtyDelta) {
                    res.status(400).json({
                        code: "insufficient_stock",
                        itemId: ln.itemId,
                        available: avail,
                        requested: -ln.qtyDelta,
                    });
                    return;
                }
            }
        }
        const docId = randomUUID();
        const userId = req.auth?.sub ?? null;
        try {
            db.transaction(() => {
                db.prepare(`INSERT INTO stock_documents (id, doc_type, supplier_id, from_location_id, to_location_id, external_ref, note, created_by_user_id)
           VALUES (?, 'adjustment', NULL, ?, ?, '', ?, ?)`).run(docId, locationId, locationId, note.trim(), userId);
                const insM = db.prepare(`INSERT INTO stock_movements (id, document_id, item_id, location_id, qty_delta, unit_cost_cdf, ledger_kind)
           VALUES (?, ?, ?, ?, ?,0, 'adjustment')`);
                for (const ln of lines) {
                    if (ln.qtyDelta === 0)
                        continue;
                    insM.run(randomUUID(), docId, ln.itemId, locationId, ln.qtyDelta);
                }
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "transaction_failed" });
            return;
        }
        res.status(201).json({ documentId: docId });
    });
    r.post("/documents/inventory-count", requireAuth, logisticsPerm, (req, res) => {
        const schema = z.object({
            locationId: z.string().min(1).max(80),
            note: z.string().max(2000).optional().default(""),
            lines: z.array(lineInventory).min(1).max(500),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ code: "validation_error" });
            return;
        }
        const { locationId, note, lines } = parsed.data;
        if (!assertLocationExists(locationId)) {
            res.status(400).json({ code: "unknown_location" });
            return;
        }
        for (const ln of lines) {
            if (!assertItemExists(ln.itemId)) {
                res.status(400).json({ code: "unknown_item", itemId: ln.itemId });
                return;
            }
        }
        const deltas = [];
        for (const ln of lines) {
            const sys = getBalance(ln.itemId, locationId);
            const delta = ln.countedQty - sys;
            if (Math.abs(delta) > 1e-9)
                deltas.push({ itemId: ln.itemId, qtyDelta: delta });
        }
        if (deltas.length === 0) {
            res.status(400).json({ code: "no_variance" });
            return;
        }
        for (const d of deltas) {
            if (d.qtyDelta < 0) {
                const avail = getBalance(d.itemId, locationId);
                if (avail + 1e-9 < -d.qtyDelta) {
                    res.status(400).json({ code: "insufficient_stock", itemId: d.itemId, available: avail });
                    return;
                }
            }
        }
        const docId = randomUUID();
        const userId = req.auth?.sub ?? null;
        try {
            db.transaction(() => {
                db.prepare(`INSERT INTO stock_documents (id, doc_type, supplier_id, from_location_id, to_location_id, external_ref, note, created_by_user_id)
           VALUES (?, 'inventory', NULL, ?, ?, '', ?, ?)`).run(docId, locationId, locationId, note.trim(), userId);
                const insM = db.prepare(`INSERT INTO stock_movements (id, document_id, item_id, location_id, qty_delta, unit_cost_cdf, ledger_kind)
           VALUES (?, ?, ?, ?, ?, 0, 'inventory')`);
                for (const d of deltas) {
                    insM.run(randomUUID(), docId, d.itemId, locationId, d.qtyDelta);
                }
            })();
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ code: "transaction_failed" });
            return;
        }
        res.status(201).json({ documentId: docId, adjustments: deltas.length });
    });
    return r;
}

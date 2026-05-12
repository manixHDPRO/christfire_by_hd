import { randomUUID } from "node:crypto";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import {
  assignedPointOfSaleIdsForUser,
  roleSeesAllCashRegisterData,
  userMayAccessPointOfSale,
} from "../cashRegisterScope.js";
import { localBusinessDateNow, requireCashDayOpenForRole } from "../cashDayOpen.js";
import {
  counterSaleItemSubcategoryRequiresPosStock,
  debitPosStockForCounterSaleUnsafe,
  firstItemNotOnPosCatalog,
  insufficientPosStockResponsePayload,
  posStockLocationIdForPointOfSale,
  PosStockInsufficientError,
  stockMovementQtyAtLocation,
  validateMergedLinesAgainstPosStock,
} from "../counterSalePosStock.js";
import { allocateNextInvoiceRefUnsafe, db } from "../db.js";
import { cdfPerUsdNow, lineTotalCdf } from "../floorSalePricing.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

/** Accès liste / points de vente / encaissement comptoir & service salle. */
const COUNTER_SALE_ACCESS = ["finance.counter", "sales.floor", "finance.treasury"] as const;

const methodEnum = z.enum(["Espèces", "Carte", "Virement", "Autre"]);

const saleLineInputSchema = z.object({
  itemId: z.string().min(1).max(80),
  qty: z.number().int().min(1).max(999),
});

const createCounterSaleSchema = z
  .object({
    amountCdf: z.number().int().min(1).max(999_999_999).optional(),
    lines: z.array(saleLineInputSchema).min(1).max(80).optional(),
    method: methodEnum.optional().default("Espèces"),
    label: z.string().max(120).optional().default(""),
    note: z.string().max(500).optional().default(""),
    clientId: z.string().max(80).optional(),
    pointOfSaleId: z.string().max(80).optional(),
    diningTableId: z.string().max(80).optional(),
  })
  .superRefine((d, ctx) => {
    const hasLines = !!(d.lines && d.lines.length > 0);
    if (!hasLines && (d.amountCdf === undefined || d.amountCdf < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount_or_lines",
        path: ["amountCdf"],
      });
    }
  });

type SaleRow = {
  id: string;
  amount_cdf: number;
  method: string;
  label: string;
  note: string;
  client_id: string | null;
  created_at: string;
  created_by_user_id: string | null;
  client_name: string | null;
  created_by_name: string | null;
  point_of_sale_id: string | null;
  point_of_sale_label: string | null;
  sale_number: number | null;
  invoice_ref: string | null;
  dining_table_id?: string | null;
  dining_table_code?: string | null;
  dining_table_label?: string | null;
  lines_count?: number;
};

function mergeLines(lines: { itemId: string; qty: number }[]): { itemId: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const ln of lines) {
    const k = ln.itemId.trim();
    map.set(k, (map.get(k) ?? 0) + ln.qty);
  }
  return [...map.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

function rowToPublic(row: SaleRow) {
  return {
    id: row.id,
    amountCdf: row.amount_cdf,
    method: row.method,
    label: row.label,
    note: row.note,
    clientId: row.client_id,
    clientName: row.client_name,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    pointOfSaleId: row.point_of_sale_id,
    pointOfSaleLabel: row.point_of_sale_label,
    invoiceRef: row.invoice_ref?.trim().length ? row.invoice_ref : undefined,
    diningTableId: row.dining_table_id ?? null,
    diningTableCode: row.dining_table_code ?? null,
    diningTableLabel: row.dining_table_label ?? null,
    linesCount:
      typeof row.lines_count === "number"
        ? row.lines_count
        : undefined,
  };
}

function saleSelectBase(): string {
  return `
      SELECT s.id, s.amount_cdf, s.method, s.label, s.note, s.client_id, s.created_at, s.created_by_user_id,
             s.point_of_sale_id, s.sale_number, s.invoice_ref,
             (SELECT COUNT(*) FROM counter_sale_lines l WHERE l.sale_id = s.id) AS lines_count,
             s.dining_table_id,
             dt.code AS dining_table_code,
             dt.label AS dining_table_label,
             c.name AS client_name,
             u.name AS created_by_name,
             p.label AS point_of_sale_label
      FROM counter_sales s
      LEFT JOIN clients c ON c.id = s.client_id
      LEFT JOIN users u ON u.id = s.created_by_user_id
      LEFT JOIN stock_points_of_sale p ON p.id = s.point_of_sale_id
      LEFT JOIN dining_terrace_tables dt ON dt.id = s.dining_table_id
  `.trim();
}

function mapJoinedRow(raw: SaleRow): SaleRow {
  return {
    ...raw,
    dining_table_code: raw.dining_table_code ?? null,
    dining_table_label: raw.dining_table_label ?? null,
  };
}

function defaultPointOfSaleId(): string {
  const row = db
    .prepare(`SELECT id FROM stock_points_of_sale WHERE active = 1 ORDER BY is_main DESC, sort_order ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  return row?.id ?? "pos-t1";
}

function defaultPointOfSaleIdForUser(role: string, userId: string): string | null {
  if (roleSeesAllCashRegisterData(role)) {
    return defaultPointOfSaleId();
  }
  const ids = assignedPointOfSaleIdsForUser(userId);
  return ids[0] ?? null;
}

function userMayViewSale(
  role: string,
  userId: string,
  row: { point_of_sale_id: string | null; created_by_user_id: string | null },
): boolean {
  if (roleSeesAllCashRegisterData(role)) return true;
  if (row.created_by_user_id !== userId) return false;
  if (!row.point_of_sale_id) return false;
  return userMayAccessPointOfSale(role, userId, row.point_of_sale_id);
}

export function counterSaleRoutes(): Router {
  const r = createRouter();

  r.get(
    "/points-of-sale",
    requireAuth,
    requireAnyPermission(...COUNTER_SALE_ACCESS),
    (req: AuthedRequest, res: Response) => {
      const role = req.auth?.role ?? "";
      const userId = req.auth?.sub ?? "";
      const globalView = roleSeesAllCashRegisterData(role);
      let sql = `SELECT id, code, label, sort_order AS sortOrder, is_main AS isMain
           FROM stock_points_of_sale WHERE active = 1`;
      const qparams: string[] = [];
      if (!globalView) {
        const ids = assignedPointOfSaleIdsForUser(userId);
        if (ids.length === 0) {
          res.json({ pointsOfSale: [] });
          return;
        }
        sql += ` AND id IN (${ids.map(() => "?").join(",")})`;
        qparams.push(...ids);
      }
      sql += ` ORDER BY sort_order ASC, code ASC`;
      const rows = db.prepare(sql).all(...qparams) as {
        id: string;
        code: string;
        label: string;
        sortOrder: number;
        isMain: number;
      }[];
      res.json({
        pointsOfSale: rows.map((x) => ({
          id: x.id,
          code: x.code,
          label: x.label,
          sortOrder: x.sortOrder,
          isMain: x.isMain === 1,
        })),
      });
    },
  );

  /** Articles vendables au comptoir / service (prix > 0, actifs). */
  r.get("/menu", requireAuth, requireAnyPermission(...COUNTER_SALE_ACCESS), (req: AuthedRequest, res: Response) => {
    const posIdRaw = typeof req.query.pointOfSaleId === "string" ? req.query.pointOfSaleId.trim() : "";
    const role = req.auth?.role ?? "";
    const userId = req.auth?.sub ?? "";
    let posId =
      posIdRaw || defaultPointOfSaleIdForUser(role, userId) || "";
    if (!roleSeesAllCashRegisterData(role) && assignedPointOfSaleIdsForUser(userId).length === 0) {
      res.status(403).json({ code: "no_point_of_sale_assignment" });
      return;
    }
    if (!posId || !userMayAccessPointOfSale(role, userId, posId)) {
      const fb =
        roleSeesAllCashRegisterData(role) ? defaultPointOfSaleId() : defaultPointOfSaleIdForUser(role, userId);
      posId = fb ?? "";
    }
    if (!posId) {
      res.status(403).json({ code: "no_point_of_sale_assignment" });
      return;
    }

    const cdf = cdfPerUsdNow();
    /** Si au moins une ligne existe pour ce PV, seuls ces articles figurent au catalogue ; sinon catalogue global (rétrocompat). */
    const rows = db
      .prepare(
        `SELECT i.id, i.code, i.label, i.unit, i.subcategory,
                COALESCE(un.label, i.unit) AS unit_label,
                i.sale_price_usd_cents AS sale_price_usd_cents
         FROM stock_items i
         LEFT JOIN stock_item_units un ON un.code = i.unit
         WHERE i.active = 1 AND i.sale_price_usd_cents > 0
           AND (
             (SELECT COUNT(*) FROM stock_item_point_of_sale WHERE point_of_sale_id = ?) = 0
             OR i.id IN (SELECT item_id FROM stock_item_point_of_sale WHERE point_of_sale_id = ?)
           )
         ORDER BY i.category ASC, i.label COLLATE NOCASE ASC`,
      )
      .all(posId, posId) as {
      id: string;
      code: string;
      label: string;
      unit: string;
      subcategory: string | null;
      unit_label: string | null;
      sale_price_usd_cents: number;
    }[];

    const stockLocId = posStockLocationIdForPointOfSale(posId);

    const items = rows.map((r) => {
      const requiresPosStock = counterSaleItemSubcategoryRequiresPosStock(r.subcategory);
      const qtyAtSaleLocation =
        requiresPosStock && stockLocId
          ? stockMovementQtyAtLocation(r.id, stockLocId)
          : requiresPosStock
            ? 0
            : undefined;
      return {
        id: r.id,
        code: r.code,
        label: r.label,
        unit: r.unit,
        unitLabel: r.unit_label ?? r.unit,
        salePriceUsdCents: r.sale_price_usd_cents,
        unitPriceCdf: Math.round((r.sale_price_usd_cents * cdf) / 100),
        ...(requiresPosStock ? { requiresPosStock: true as const, qtyAtSaleLocation } : {}),
      };
    });

    res.json({ cdfPerUsd: cdf, items, pointOfSaleId: posId });
  });

  /** Tables actives pour un point de vente (service salle). */
  r.get("/dining-tables", requireAuth, requireAnyPermission(...COUNTER_SALE_ACCESS), (req: AuthedRequest, res: Response) => {
    const posId = typeof req.query.pointOfSaleId === "string" ? req.query.pointOfSaleId.trim() : "";
    const role = req.auth?.role ?? "";
    const userId = req.auth?.sub ?? "";
    if (!posId) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    if (!userMayAccessPointOfSale(role, userId, posId)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }
    const rows = db
      .prepare(
        `SELECT id, code, label, seats, sort_order AS sortOrder
         FROM dining_terrace_tables
         WHERE point_of_sale_id = ? AND active = 1
         ORDER BY sort_order ASC, code COLLATE NOCASE ASC`,
      )
      .all(posId) as { id: string; code: string; label: string; seats: number; sortOrder: number }[];

    res.json({
      tables: rows.map((t) => ({
        id: t.id,
        code: t.code,
        label: t.label,
        seats: t.seats,
        sortOrder: t.sortOrder,
      })),
    });
  });

  r.get("/:id", requireAuth, requireAnyPermission(...COUNTER_SALE_ACCESS), (req: AuthedRequest, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id || id.length > 80) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const role = req.auth?.role ?? "";
    const userId = req.auth?.sub ?? "";

    const raw = db
      .prepare(`${saleSelectBase()} WHERE s.id = ?`)
      .get(id) as SaleRow | undefined;
    if (!raw) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const mapped = mapJoinedRow(raw);
    if (!userMayViewSale(role, userId, mapped)) {
      res.status(403).json({ code: "forbidden" });
      return;
    }

    const lines = db
      .prepare(
        `SELECT l.id, l.item_id AS itemId, l.qty, l.unit_price_usd_cents AS unitPriceUsdCents,
                l.line_total_cdf AS lineTotalCdf, l.label_snapshot AS label
         FROM counter_sale_lines l
         WHERE l.sale_id = ?
         ORDER BY l.id ASC`,
      )
      .all(id) as {
      id: string;
      itemId: string;
      qty: number;
      unitPriceUsdCents: number;
      lineTotalCdf: number;
      label: string;
    }[];

    res.json({ sale: { ...rowToPublic(mapped), lines } });
  });

  r.get("/", requireAuth, requireAnyPermission(...COUNTER_SALE_ACCESS), (req: AuthedRequest, res: Response) => {
    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;

    const conditions: string[] = ["1=1"];
    const params: string[] = [];
    if (from) {
      conditions.push("date(s.created_at) >= date(?)");
      params.push(from);
    }
    if (to) {
      conditions.push("date(s.created_at) <= date(?)");
      params.push(to);
    }

    const role = req.auth?.role ?? "";
    const userId = req.auth?.sub ?? "";
    if (!roleSeesAllCashRegisterData(role)) {
      const posIds = assignedPointOfSaleIdsForUser(userId);
      if (posIds.length === 0) {
        res.json({ sales: [] });
        return;
      }
      const ph = posIds.map(() => "?").join(",");
      conditions.push(`s.point_of_sale_id IN (${ph})`);
      params.push(...posIds);
      conditions.push("s.created_by_user_id = ?");
      params.push(userId);
    }

    const sql = `
      ${saleSelectBase()}
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 500
    `;

    const rows = db.prepare(sql).all(...params) as SaleRow[];
    const sales = rows.map((raw) => rowToPublic(mapJoinedRow(raw)));
    res.json({ sales });
  });

  r.post("/", requireAuth, requireAnyPermission(...COUNTER_SALE_ACCESS), (req: AuthedRequest, res: Response) => {
    const parsed = createCounterSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      if (parsed.error.errors.some((e) => e.message === "amount_or_lines")) {
        res.status(400).json({ code: "amount_or_lines" });
        return;
      }
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    let pointOfSaleId = parsed.data.pointOfSaleId?.trim() || defaultPointOfSaleIdForUser(role, uid) || "";

    let diningTableId: string | null = parsed.data.diningTableId?.trim() || null;
    const mergedLines =
      parsed.data.lines && parsed.data.lines.length > 0 ? mergeLines(parsed.data.lines) : null;

    const posOk = db.prepare("SELECT 1 FROM stock_points_of_sale WHERE id = ? AND active = 1").get(pointOfSaleId);
    if (!posOk) {
      const fb = defaultPointOfSaleIdForUser(role, uid);
      pointOfSaleId = fb ?? "";
    }
    if (!pointOfSaleId) {
      res.status(403).json({ code: "no_point_of_sale_assignment" });
      return;
    }

    if (!userMayAccessPointOfSale(role, uid, pointOfSaleId)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }

    if (!requireCashDayOpenForRole(role, localBusinessDateNow(), res)) return;

    const clientIdRaw = parsed.data.clientId?.trim();
    const clientId = clientIdRaw || null;
    if (clientId) {
      const ok = db.prepare("SELECT 1 AS x FROM clients WHERE id = ?").get(clientId) as { x: number } | undefined;
      if (!ok) {
        res.status(400).json({ code: "unknown_client" });
        return;
      }
    }

    let amountCdf: number;
    let saleLabel: string;

    let lineTuples: {
      itemId: string;
      qty: number;
      unitUsdCents: number;
      lineCdf: number;
      labelSnap: string;
    }[];

    const cdfFx = cdfPerUsdNow();

    if (mergedLines?.length) {
      lineTuples = [];
      let total = 0;
      const labelParts: string[] = [];

      const itemStmt = db.prepare(
        `SELECT id, label, sale_price_usd_cents FROM stock_items WHERE id = ? AND active = 1`,
      );

      for (const ln of mergedLines) {
        const row = itemStmt.get(ln.itemId) as { id: string; label: string; sale_price_usd_cents: number } | undefined;
        if (!row || row.sale_price_usd_cents <= 0) {
          res.status(400).json({ code: "unknown_or_unpriced_item", itemId: ln.itemId });
          return;
        }
        const lineCdf = lineTotalCdf(ln.qty, row.sale_price_usd_cents, cdfFx);
        total += lineCdf;
        labelParts.push(`${row.label}×${ln.qty}`);
        lineTuples.push({
          itemId: row.id,
          qty: ln.qty,
          unitUsdCents: row.sale_price_usd_cents,
          lineCdf,
          labelSnap: row.label,
        });
      }

      const notOnPosCatalog = firstItemNotOnPosCatalog(mergedLines, pointOfSaleId);
      if (notOnPosCatalog) {
        res.status(400).json({ code: "item_not_on_pos_catalog", itemId: notOnPosCatalog });
        return;
      }

      const violSale = validateMergedLinesAgainstPosStock(mergedLines, pointOfSaleId);
      if (violSale) {
        res.status(400).json(insufficientPosStockResponsePayload(violSale));
        return;
      }

      amountCdf = total;
      if (amountCdf < 1) {
        res.status(400).json({ code: "validation_error" });
        return;
      }
      saleLabel = labelParts.join(", ").slice(0, 250);
      if (!saleLabel.trim()) saleLabel = "Vente détaillée";
    } else {
      amountCdf = parsed.data.amountCdf ?? 0;
      saleLabel = parsed.data.label.trim() || "Vente";
      lineTuples = [];
    }

    if (diningTableId) {
      const trow = db
        .prepare(
          `SELECT 1 FROM dining_terrace_tables
           WHERE id = ? AND point_of_sale_id = ? AND active = 1`,
        )
        .get(diningTableId, pointOfSaleId) as { 1?: number } | undefined;
      if (!trow) {
        res.status(400).json({ code: "invalid_table" });
        return;
      }
    } else {
      diningTableId = null;
    }

    const id = randomUUID();
    const userId = req.auth?.sub ?? null;

    try {
      const run = db.transaction(() => {
        const invoiceRef = allocateNextInvoiceRefUnsafe(localBusinessDateNow());
        db.prepare(
          `INSERT INTO counter_sales (id, amount_cdf, method, label, note, client_id, created_by_user_id, point_of_sale_id, dining_table_id, invoice_ref)
           VALUES (@id, @amount_cdf, @method, @label, @note, @client_id, @created_by_user_id, @point_of_sale_id, @dining_table_id, @invoice_ref)`,
        ).run({
          id,
          amount_cdf: amountCdf,
          method: parsed.data.method,
          label: saleLabel,
          note: parsed.data.note.trim(),
          client_id: clientId,
          created_by_user_id: userId,
          point_of_sale_id: pointOfSaleId,
          dining_table_id: diningTableId,
          invoice_ref: invoiceRef,
        });
        const insLn = db.prepare(
          `INSERT INTO counter_sale_lines (id, sale_id, item_id, qty, unit_price_usd_cents, line_total_cdf, label_snapshot)
           VALUES (@id, @sale_id, @item_id, @qty, @unit_price_usd_cents, @line_total_cdf, @label_snapshot)`,
        );
        for (const ln of lineTuples) {
          insLn.run({
            id: randomUUID(),
            sale_id: id,
            item_id: ln.itemId,
            qty: ln.qty,
            unit_price_usd_cents: ln.unitUsdCents,
            line_total_cdf: ln.lineCdf,
            label_snapshot: ln.labelSnap,
          });
        }
        if (mergedLines && mergedLines.length > 0) {
          debitPosStockForCounterSaleUnsafe({
            counterSaleId: id,
            pointOfSaleId,
            mergedLines,
            createdByUserId: userId,
            invoiceRef,
          });
        }
      });
      run();
    } catch (e) {
      if (e instanceof PosStockInsufficientError) {
        res.status(400).json(insufficientPosStockResponsePayload(e.viol));
        return;
      }
      console.error(e);
      res.status(500).json({ code: "insert_failed" });
      return;
    }

    const raw = db.prepare(`${saleSelectBase()} WHERE s.id = ?`).get(id) as SaleRow | undefined;
    if (!raw) {
      res.status(500).json({ code: "read_failed" });
      return;
    }
    const mapped = mapJoinedRow(raw);
    res.status(201).json({ sale: rowToPublic(mapped) });
  });

  return r;
}

import { randomUUID } from "node:crypto";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { roleSeesAllCashRegisterData, userMayAccessPointOfSale } from "../cashRegisterScope.js";
import { localBusinessDateNow, requireCashDayOpenForRole } from "../cashDayOpen.js";
import { assignInvoiceRefIfMissingForOpenTabUnsafe, allocateNextInvoiceRefUnsafe, db, ensureFloorTabInvoiceRef } from "../db.js";
import { cdfPerUsdNow, lineTotalCdf } from "../floorSalePricing.js";
import {
  applyFloorTabPosStockDeltaUnsafe,
  firstItemNotOnPosCatalog,
  insufficientPosStockResponsePayload,
  PosStockInsufficientError,
  validatePosStockDeltaForTabLineUpdate,
} from "../counterSalePosStock.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { roleHasPermission } from "../permissions.js";

const FLOOR_TAB_ACCESS = ["finance.counter", "sales.floor", "finance.treasury"] as const;

/** Encaissement : uniquement comptoir caisse (pas `sales.floor` seul). */
const FLOOR_CHECKOUT_ACCESS = ["finance.counter"] as const;

/** Comptoir sans « service salle » : voir toutes les additions pour encaisser, sans ouvrir ni modifier les lignes. */
function roleIsFloorCashCounterOnly(role: string): boolean {
  if (!roleHasPermission(role, "finance.counter")) return false;
  if (roleSeesAllCashRegisterData(role)) return false;
  if (roleHasPermission(role, "sales.floor")) return false;
  return true;
}

function roleMayServeOpenFloorTabs(role: string): boolean {
  if (roleSeesAllCashRegisterData(role)) return true;
  return roleHasPermission(role, "sales.floor");
}

function userMayEditTab(role: string, uid: string, tab: TabRow): boolean {
  if (roleSeesAllCashRegisterData(role)) return true;
  return tab.opened_by_user_id === uid;
}

/** Lecture addition (dont caissière sur tables des serveurs du même POS assigné). */
function userMayViewFloorTab(role: string, uid: string, tab: TabRow): boolean {
  if (roleIsFloorCashCounterOnly(role)) return userMayAccessPointOfSale(role, uid, tab.point_of_sale_id);
  return userMayEditTab(role, uid, tab);
}

const methodEnum = z.enum(["Espèces", "Carte", "Virement", "Autre"]);

const openBodySchema = z.object({
  pointOfSaleId: z.string().min(1).max(80),
  diningTableId: z.string().min(1).max(80),
});

const putLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1).max(80),
        qty: z.number().int().min(0).max(999),
      }),
    )
    .max(80),
});

const checkoutSchema = z.object({
  method: methodEnum.optional().default("Espèces"),
  note: z.string().max(500).optional().default(""),
  clientId: z.string().max(80).optional(),
});

function routeParamSingle(v: string | string[] | undefined): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? "";
  return "";
}

type TabRow = {
  id: string;
  point_of_sale_id: string;
  dining_table_id: string;
  opened_by_user_id: string;
  opened_at: string;
  note: string;
  settled_at: string | null;
  counter_sale_id: string | null;
  sale_number: number | null;
  invoice_ref: string | null;
};

function mergeLines(lines: { itemId: string; qty: number }[]): { itemId: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const ln of lines) {
    const k = ln.itemId.trim();
    map.set(k, (map.get(k) ?? 0) + ln.qty);
  }
  return [...map.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([itemId, qty]) => ({ itemId, qty }));
}

function loadTabRow(id: string): TabRow | undefined {
  return db.prepare(`SELECT * FROM floor_service_tabs WHERE id = ?`).get(id) as TabRow | undefined;
}

function buildTabPublic(tabId: string, cdfFx: number) {
  const tab = loadTabRow(tabId);
  if (!tab || tab.settled_at) return null;

  ensureFloorTabInvoiceRef(tabId);
  const tabRow = loadTabRow(tabId);
  if (!tabRow || !tabRow.invoice_ref || tabRow.invoice_ref.trim().length === 0) return null;

  const openerName = db
    .prepare(`SELECT name FROM users WHERE id = ?`)
    .get(tabRow.opened_by_user_id) as { name: string } | undefined;

  const tmeta = db
    .prepare(
      `SELECT dt.code AS table_code, dt.label AS table_label
       FROM dining_terrace_tables dt WHERE dt.id = ?`,
    )
    .get(tab.dining_table_id) as { table_code: string; table_label: string } | undefined;

  const lineRows = db
    .prepare(
      `SELECT l.item_id, l.qty, i.label, i.sale_price_usd_cents
       FROM floor_service_tab_lines l
       JOIN stock_items i ON i.id = l.item_id
       WHERE l.tab_id = ?
       ORDER BY i.label ASC`,
    )
    .all(tabId) as {
    item_id: string;
    qty: number;
    label: string;
    sale_price_usd_cents: number;
  }[];

  let totalCdf = 0;
  const lines = lineRows.map((r) => {
    const lineTotal = lineTotalCdf(r.qty, r.sale_price_usd_cents, cdfFx);
    totalCdf += lineTotal;
    return {
      itemId: r.item_id,
      qty: r.qty,
      label: r.label,
      unitPriceUsdCents: r.sale_price_usd_cents,
      lineTotalCdf: lineTotal,
    };
  });

  return {
    id: tabRow.id,
    pointOfSaleId: tabRow.point_of_sale_id,
    diningTableId: tabRow.dining_table_id,
    tableCode: tmeta?.table_code ?? "",
    tableLabel: tmeta?.table_label ?? "",
    openedByUserId: tabRow.opened_by_user_id,
    openedByName: openerName?.name?.trim() || undefined,
    openedAt: tabRow.opened_at,
    note: tabRow.note,
    invoiceRef: tabRow.invoice_ref,
    lines,
    totalCdf,
  };
}

export function floorTabsRoutes(): Router {
  const r = createRouter();

  r.get("/board", requireAuth, requireAnyPermission(...FLOOR_TAB_ACCESS), (req: AuthedRequest, res: Response) => {
    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    const posId = typeof req.query.pointOfSaleId === "string" ? req.query.pointOfSaleId.trim() : "";
    if (!posId) {
      res.status(400).json({ code: "point_of_sale_required" });
      return;
    }
    if (!userMayAccessPointOfSale(role, uid, posId)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }

    const rows = db
      .prepare(
        `SELECT dt.id AS table_id, dt.code AS table_code, dt.label AS table_label, dt.seats, dt.sort_order,
                t.id AS tab_id, t.opened_by_user_id, u.name AS opened_by_name
         FROM dining_terrace_tables dt
         LEFT JOIN floor_service_tabs t ON t.dining_table_id = dt.id AND t.settled_at IS NULL
         LEFT JOIN users u ON u.id = t.opened_by_user_id
         WHERE dt.point_of_sale_id = ? AND dt.active = 1
         ORDER BY dt.sort_order ASC, dt.code ASC`,
      )
      .all(posId) as {
      table_id: string;
      table_code: string;
      table_label: string;
      seats: number;
      sort_order: number;
      tab_id: string | null;
      opened_by_user_id: string | null;
      opened_by_name: string | null;
    }[];

    const treasury = roleSeesAllCashRegisterData(role);
    const cashierTerrace = roleIsFloorCashCounterOnly(role);
    const cdfFx = cdfPerUsdNow();

    const lineStmt = db.prepare(
      `SELECT l.qty, i.sale_price_usd_cents
       FROM floor_service_tab_lines l
       JOIN stock_items i ON i.id = l.item_id
       WHERE l.tab_id = ?`,
    );

    let hiddenBusyTables = 0;

    type BoardCell =
      | { tableId: string; code: string; label: string; seats: number; sortOrder: number; vacant: true }
      | {
          tableId: string;
          code: string;
          label: string;
          seats: number;
          sortOrder: number;
          vacant: false;
          tabId: string;
          canEdit: boolean;
          openedByName?: string;
          lineCount: number;
          totalCdf: number;
        };

    const board: BoardCell[] = [];

    for (const row of rows) {
      const base = {
        tableId: row.table_id,
        code: row.table_code,
        label: row.table_label,
        seats: row.seats,
        sortOrder: row.sort_order,
      };
      if (!row.tab_id) {
        board.push({ ...base, vacant: true });
        continue;
      }

      const mine = row.opened_by_user_id === uid;
      /** Hors trésorerie et hors vue caisse terrasse : les tables prises par un collègue ne sont pas listées du tout. */
      if (!treasury && !mine && !cashierTerrace) {
        hiddenBusyTables += 1;
        continue;
      }

      const lines = lineStmt.all(row.tab_id) as { qty: number; sale_price_usd_cents: number }[];
      let totalCdf = 0;
      for (const ln of lines) {
        totalCdf += lineTotalCdf(ln.qty, ln.sale_price_usd_cents, cdfFx);
      }
      const lineCount = lines.length;

      board.push({
        ...base,
        vacant: false,
        tabId: row.tab_id,
        canEdit: !cashierTerrace && (treasury || mine),
        openedByName: cashierTerrace
          ? (row.opened_by_name ?? undefined)
          : mine
            ? undefined
            : (row.opened_by_name ?? undefined),
        lineCount,
        totalCdf,
      });
    }

    res.json({ board, ...(treasury || cashierTerrace ? {} : { hiddenBusyTables }) });
  });

  r.post("/open", requireAuth, requireAnyPermission(...FLOOR_TAB_ACCESS), (req: AuthedRequest, res: Response) => {
    const parsed = openBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    const posId = parsed.data.pointOfSaleId.trim();
    const diningTableId = parsed.data.diningTableId.trim();

    if (!userMayAccessPointOfSale(role, uid, posId)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }

    if (!roleMayServeOpenFloorTabs(role)) {
      res.status(403).json({ code: "floor_serve_role_required" });
      return;
    }

    const tok = db
      .prepare(
        `SELECT 1 FROM dining_terrace_tables
         WHERE id = ? AND point_of_sale_id = ? AND active = 1`,
      )
      .get(diningTableId, posId) as { 1?: number } | undefined;
    if (!tok) {
      res.status(400).json({ code: "invalid_table" });
      return;
    }

    const existing = db
      .prepare(
        `SELECT t.id, t.opened_by_user_id, u.name AS opened_by_name
         FROM floor_service_tabs t
         LEFT JOIN users u ON u.id = t.opened_by_user_id
         WHERE t.dining_table_id = ? AND t.settled_at IS NULL`,
      )
      .get(diningTableId) as
      | { id: string; opened_by_user_id: string; opened_by_name: string | null }
      | undefined;

    const treasury = roleSeesAllCashRegisterData(role);
    const cdfFx = cdfPerUsdNow();

    if (existing) {
      const mine = existing.opened_by_user_id === uid;
      if (!mine && !treasury) {
        res.status(409).json({
          code: "table_busy",
          openedByName: existing.opened_by_name ?? undefined,
        });
        return;
      }
      const detail = buildTabPublic(existing.id, cdfFx);
      if (!detail) {
        res.status(500).json({ code: "read_failed" });
        return;
      }
      res.json({ tab: detail });
      return;
    }

    const id = randomUUID();
    try {
      const run = db.transaction(() => {
        const biz = localBusinessDateNow();
        const invRef = allocateNextInvoiceRefUnsafe(biz);
        db.prepare(
          `INSERT INTO floor_service_tabs (id, point_of_sale_id, dining_table_id, opened_by_user_id, note, settled_at, counter_sale_id, invoice_ref)
           VALUES (?, ?, ?, ?, '', NULL, NULL, ?)`,
        ).run(id, posId, diningTableId, uid, invRef);
      });
      run();
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "insert_failed" });
      return;
    }

    const detail = buildTabPublic(id, cdfFx);
    if (!detail) {
      res.status(500).json({ code: "read_failed" });
      return;
    }
    res.status(201).json({ tab: detail });
  });

  r.get("/:tabId", requireAuth, requireAnyPermission(...FLOOR_TAB_ACCESS), (req: AuthedRequest, res: Response) => {
    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    const tabId = routeParamSingle(req.params.tabId);
    const tab = loadTabRow(tabId);
    if (!tab || tab.settled_at) {
      res.status(404).json({ code: "tab_not_found" });
      return;
    }
    if (!userMayViewFloorTab(role, uid, tab)) {
      res.status(403).json({ code: "forbidden_tab" });
      return;
    }
    if (!userMayAccessPointOfSale(role, uid, tab.point_of_sale_id)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }

    const detail = buildTabPublic(tabId, cdfPerUsdNow());
    if (!detail) {
      res.status(404).json({ code: "tab_not_found" });
      return;
    }
    res.json({ tab: detail });
  });

  r.put("/:tabId/lines", requireAuth, requireAnyPermission(...FLOOR_TAB_ACCESS), (req: AuthedRequest, res: Response) => {
    const parsed = putLinesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    const tabId = routeParamSingle(req.params.tabId);
    const tab = loadTabRow(tabId);
    if (!tab || tab.settled_at) {
      res.status(404).json({ code: "tab_not_found" });
      return;
    }
    if (!userMayEditTab(role, uid, tab)) {
      res.status(403).json({ code: "forbidden_tab" });
      return;
    }
    if (!userMayAccessPointOfSale(role, uid, tab.point_of_sale_id)) {
      res.status(403).json({ code: "forbidden_point_of_sale" });
      return;
    }

    const merged = mergeLines(parsed.data.lines);
    const itemStmt = db.prepare(
      `SELECT id, label, sale_price_usd_cents FROM stock_items WHERE id = ? AND active = 1`,
    );
    const cdfFx = cdfPerUsdNow();

    for (const ln of merged) {
      const row = itemStmt.get(ln.itemId) as { id: string; label: string; sale_price_usd_cents: number } | undefined;
      if (!row || row.sale_price_usd_cents <= 0) {
        res.status(400).json({ code: "unknown_or_unpriced_item", itemId: ln.itemId });
        return;
      }
    }

    const notInCatalog = firstItemNotOnPosCatalog(merged, tab.point_of_sale_id);
    if (notInCatalog) {
      res.status(400).json({ code: "item_not_on_pos_catalog", itemId: notInCatalog });
      return;
    }

    try {
      const run = db.transaction(() => {
        const oldRows = db
          .prepare(`SELECT item_id, qty FROM floor_service_tab_lines WHERE tab_id = ?`)
          .all(tabId) as { item_id: string; qty: number }[];
        const oldMerged = mergeLines(oldRows.map((r) => ({ itemId: r.item_id, qty: r.qty })));

        const viol = validatePosStockDeltaForTabLineUpdate(oldMerged, merged, tab.point_of_sale_id);
        if (viol) throw new PosStockInsufficientError(viol);

        db.prepare(`DELETE FROM floor_service_tab_lines WHERE tab_id = ?`).run(tabId);
        const ins = db.prepare(
          `INSERT INTO floor_service_tab_lines (id, tab_id, item_id, qty) VALUES (?, ?, ?, ?)`,
        );
        for (const ln of merged) {
          ins.run(randomUUID(), tabId, ln.itemId, ln.qty);
        }
        applyFloorTabPosStockDeltaUnsafe({
          tabId,
          pointOfSaleId: tab.point_of_sale_id,
          oldMerged,
          newMerged: merged,
          createdByUserId: uid.trim() !== "" ? uid : null,
        });
      });
      run();
    } catch (e) {
      if (e instanceof PosStockInsufficientError) {
        res.status(400).json(insufficientPosStockResponsePayload(e.viol));
        return;
      }
      console.error(e);
      res.status(500).json({ code: "update_failed" });
      return;
    }

    const detail = buildTabPublic(tabId, cdfFx);
    if (!detail) {
      res.status(500).json({ code: "read_failed" });
      return;
    }
    res.json({ tab: detail });
  });

  r.post(
    "/:tabId/checkout",
    requireAuth,
    requireAnyPermission(...FLOOR_CHECKOUT_ACCESS),
    (req: AuthedRequest, res: Response) => {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "validation_error" });
        return;
      }

      const role = req.auth?.role ?? "";
      const uid = req.auth?.sub ?? "";
      const tabId = routeParamSingle(req.params.tabId);
      const tab = loadTabRow(tabId);
      if (!tab || tab.settled_at) {
        res.status(404).json({ code: "tab_not_found" });
        return;
      }
      if (!userMayViewFloorTab(role, uid, tab)) {
        res.status(403).json({ code: "forbidden_tab" });
        return;
      }
      if (!userMayAccessPointOfSale(role, uid, tab.point_of_sale_id)) {
        res.status(403).json({ code: "forbidden_point_of_sale" });
        return;
      }
      if (!requireCashDayOpenForRole(role, localBusinessDateNow(), res)) return;

      const clientIdRaw = parsed.data.clientId?.trim();
      const clientId = clientIdRaw || null;
      if (clientId) {
        const ok = db.prepare(`SELECT 1 AS x FROM clients WHERE id = ?`).get(clientId) as { x: number } | undefined;
        if (!ok) {
          res.status(400).json({ code: "unknown_client" });
          return;
        }
      }

      const cdfFx = cdfPerUsdNow();
      const lineRows = db
        .prepare(
          `SELECT l.item_id, l.qty, i.label, i.sale_price_usd_cents
           FROM floor_service_tab_lines l
           JOIN stock_items i ON i.id = l.item_id
           WHERE l.tab_id = ?`,
        )
        .all(tabId) as {
        item_id: string;
        qty: number;
        label: string;
        sale_price_usd_cents: number;
      }[];

      if (lineRows.length === 0) {
        res.status(400).json({ code: "empty_tab" });
        return;
      }

      const labelParts: string[] = [];
      let amountCdf = 0;
      const lineTuples: {
        itemId: string;
        qty: number;
        unitUsdCents: number;
        lineCdf: number;
        labelSnap: string;
      }[] = [];

      for (const r0 of lineRows) {
        const lineCdf = lineTotalCdf(r0.qty, r0.sale_price_usd_cents, cdfFx);
        amountCdf += lineCdf;
        labelParts.push(`${r0.label}×${r0.qty}`);
        lineTuples.push({
          itemId: r0.item_id,
          qty: r0.qty,
          unitUsdCents: r0.sale_price_usd_cents,
          lineCdf,
          labelSnap: r0.label,
        });
      }

      if (amountCdf < 1) {
        res.status(400).json({ code: "validation_error" });
        return;
      }

      let saleLabel = labelParts.join(", ").slice(0, 250);
      if (!saleLabel.trim()) saleLabel = "Vente détaillée";

      const saleId = randomUUID();
      const userId = req.auth?.sub ?? null;
      const diningTableId = tab.dining_table_id;
      const pointOfSaleId = tab.point_of_sale_id;

      let checkoutInvoiceRef: string | undefined;
      try {
        const run = db.transaction(() => {
          const invRef = assignInvoiceRefIfMissingForOpenTabUnsafe(tabId);
          checkoutInvoiceRef = invRef;
          db.prepare(
            `INSERT INTO counter_sales (id, amount_cdf, method, label, note, client_id, created_by_user_id, point_of_sale_id, dining_table_id, invoice_ref)
             VALUES (@id, @amount_cdf, @method, @label, @note, @client_id, @created_by_user_id, @point_of_sale_id, @dining_table_id, @invoice_ref)`,
          ).run({
            id: saleId,
            amount_cdf: amountCdf,
            method: parsed.data.method,
            label: saleLabel,
            note: parsed.data.note.trim(),
            client_id: clientId,
            created_by_user_id: userId,
            point_of_sale_id: pointOfSaleId,
            dining_table_id: diningTableId,
            invoice_ref: invRef,
          });
          const insLn = db.prepare(
            `INSERT INTO counter_sale_lines (id, sale_id, item_id, qty, unit_price_usd_cents, line_total_cdf, label_snapshot)
             VALUES (@id, @sale_id, @item_id, @qty, @unit_price_usd_cents, @line_total_cdf, @label_snapshot)`,
          );
          for (const ln of lineTuples) {
            insLn.run({
              id: randomUUID(),
              sale_id: saleId,
              item_id: ln.itemId,
              qty: ln.qty,
              unit_price_usd_cents: ln.unitUsdCents,
              line_total_cdf: ln.lineCdf,
              label_snapshot: ln.labelSnap,
            });
          }
          db.prepare(
            `UPDATE floor_service_tabs SET settled_at = datetime('now'), counter_sale_id = ? WHERE id = ? AND settled_at IS NULL`,
          ).run(saleId, tabId);
        });
        run();
      } catch (e) {
        if (e instanceof PosStockInsufficientError) {
          res.status(400).json(insufficientPosStockResponsePayload(e.viol));
          return;
        }
        console.error(e);
        res.status(500).json({ code: "checkout_failed" });
        return;
      }

      res.status(201).json({
        counterSaleId: saleId,
        amountCdf,
        diningTableId,
        pointOfSaleId,
        invoiceRef: checkoutInvoiceRef,
      });
    },
  );

  r.delete("/:tabId", requireAuth, requireAnyPermission(...FLOOR_TAB_ACCESS), (req: AuthedRequest, res: Response) => {
    const role = req.auth?.role ?? "";
    const uid = req.auth?.sub ?? "";
    const tabId = routeParamSingle(req.params.tabId);
    const tab = loadTabRow(tabId);
    if (!tab || tab.settled_at) {
      res.status(404).json({ code: "tab_not_found" });
      return;
    }
    if (!userMayEditTab(role, uid, tab)) {
      res.status(403).json({ code: "forbidden_tab" });
      return;
    }

    const n = db.prepare(`SELECT COUNT(*) AS c FROM floor_service_tab_lines WHERE tab_id = ?`).get(tabId) as {
      c: number;
    };
    if (n.c > 0) {
      res.status(400).json({ code: "tab_has_lines" });
      return;
    }

    try {
      db.prepare(`DELETE FROM floor_service_tabs WHERE id = ?`).run(tabId);
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "delete_failed" });
      return;
    }
    res.status(204).end();
  });

  return r;
}
